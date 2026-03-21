package main

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/clerk/clerk-sdk-go/v2/jwks"
	"github.com/clerk/clerk-sdk-go/v2/jwt"
	expirable "github.com/hashicorp/golang-lru/v2/expirable"
)

type authMethod int

const (
	authMethodClerk  authMethod = iota
	authMethodAPIKey
)

type authInfo struct {
	UserID string
	Method authMethod
	KeyID  string // only set for API key auth
}

type authInfoKeyType struct{}

var authInfoKey = authInfoKeyType{}

func authInfoFromCtx(ctx context.Context) (authInfo, bool) {
	v, ok := ctx.Value(authInfoKey).(authInfo)
	return v, ok
}

func mustAuth(ctx context.Context) authInfo {
	info, ok := authInfoFromCtx(ctx)
	if !ok {
		panic("auth info not in context — middleware misconfigured")
	}
	return info
}

// ensureUserFunc upserts a user row when Clerk auth succeeds.
type ensureUserFunc func(userID string)

// authenticator holds state for Clerk JWT and API key validation.
type authenticator struct {
	db          *sql.DB
	jwksClient  *jwks.Client
	jwkStore    *inMemoryJWKStore
	ensureUser  ensureUserFunc
	apiKeyCache *expirable.LRU[string, authInfo] // keyHash -> authInfo
}

type inMemoryJWKStore struct {
	jwk *clerk.JSONWebKey
}

func newAuthenticator(db *sql.DB, clerkSecretKey string) *authenticator {
	config := &clerk.ClientConfig{}
	config.Key = clerk.String(clerkSecretKey)
	return &authenticator{
		db:          db,
		jwksClient:  jwks.NewClient(config),
		jwkStore:    &inMemoryJWKStore{},
		apiKeyCache: expirable.NewLRU[string, authInfo](1000, nil, 5*time.Minute),
		ensureUser: func(userID string) {
			if db != nil {
				dbUpsertUser(db, userID, "", "")
			}
		},
	}
}

// authenticate extracts a Bearer token from the request and returns auth info.
// Returns nil if no valid credentials found.
func (a *authenticator) authenticate(ctx context.Context, token string) (*authInfo, error) {
	if token == "" {
		return nil, nil
	}

	// API key auth: tokens starting with dzl_ (or legacy bstr_)
	if strings.HasPrefix(token, "dzl_") || strings.HasPrefix(token, "bstr_") {
		hash := hashAPIKey(token)
		if cached, ok := a.apiKeyCache.Get(hash); ok {
			go dbTouchAPIKey(a.db, cached.KeyID)
			return &cached, nil
		}
		userID, keyID, err := dbLookupAPIKey(a.db, hash)
		if err != nil {
			return nil, err
		}
		info := authInfo{UserID: userID, Method: authMethodAPIKey, KeyID: keyID}
		a.apiKeyCache.Add(hash, info)
		go dbTouchAPIKey(a.db, keyID)
		return &info, nil
	}

	// Clerk JWT auth
	info, err := a.verifyClerkJWT(ctx, token)
	if err == nil && info != nil && a.ensureUser != nil {
		a.ensureUser(info.UserID)
	}
	return info, err
}

func (a *authenticator) verifyClerkJWT(ctx context.Context, token string) (*authInfo, error) {
	// Try cached JWK first
	jwk := a.jwkStore.jwk
	if jwk == nil {
		unsafeClaims, err := jwt.Decode(ctx, &jwt.DecodeParams{Token: token})
		if err != nil {
			return nil, err
		}
		jwk, err = jwt.GetJSONWebKey(ctx, &jwt.GetJSONWebKeyParams{
			KeyID:      unsafeClaims.KeyID,
			JWKSClient: a.jwksClient,
		})
		if err != nil {
			return nil, err
		}
		a.jwkStore.jwk = jwk
	}

	claims, err := jwt.Verify(ctx, &jwt.VerifyParams{Token: token, JWK: jwk})
	if err != nil {
		// JWK might be rotated — clear cache and retry once
		a.jwkStore.jwk = nil
		unsafeClaims, decErr := jwt.Decode(ctx, &jwt.DecodeParams{Token: token})
		if decErr != nil {
			return nil, err
		}
		jwk, fetchErr := jwt.GetJSONWebKey(ctx, &jwt.GetJSONWebKeyParams{
			KeyID:      unsafeClaims.KeyID,
			JWKSClient: a.jwksClient,
		})
		if fetchErr != nil {
			return nil, err
		}
		a.jwkStore.jwk = jwk
		claims, err = jwt.Verify(ctx, &jwt.VerifyParams{Token: token, JWK: jwk})
		if err != nil {
			return nil, err
		}
	}

	return &authInfo{UserID: claims.Subject, Method: authMethodClerk}, nil
}

// extractBearerToken gets the token from Authorization header or query param.
func extractBearerToken(r *http.Request) string {
	if auth := r.Header.Get("Authorization"); auth != "" {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	if t := r.URL.Query().Get("token"); t != "" {
		return t
	}
	return ""
}

// authInterceptor implements connect.Interceptor for both unary and streaming RPCs.
type authInterceptor struct {
	auth *authenticator
}

func newAuthInterceptor(auth *authenticator) *authInterceptor {
	return &authInterceptor{auth: auth}
}

// publicProcedures lists RPC procedures that allow unauthenticated access.
// Auth is still attempted if a token is present, but missing/invalid tokens
// are not rejected — the handler checks authInfoFromCtx to decide what to return.
var publicProcedures = map[string]bool{
	"/dazzle.v1.StageService/GetStage": true,
}

func (i *authInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		token := strings.TrimPrefix(req.Header().Get("Authorization"), "Bearer ")

		// Public procedures: attempt auth if token present, but allow through regardless
		if publicProcedures[req.Spec().Procedure] {
			if token != "" {
				if info, err := i.auth.authenticate(ctx, token); err == nil && info != nil {
					ctx = context.WithValue(ctx, authInfoKey, *info)
				}
			}
			return next(ctx, req)
		}

		if token == "" {
			return nil, connect.NewError(connect.CodeUnauthenticated, nil)
		}

		info, err := i.auth.authenticate(ctx, token)
		if err != nil || info == nil {
			log.Printf("Auth failed: %v", err)
			return nil, connect.NewError(connect.CodeUnauthenticated, nil)
		}

		ctx = context.WithValue(ctx, authInfoKey, *info)
		return next(ctx, req)
	}
}

func (i *authInterceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return next // passthrough — control-plane doesn't make outbound streaming calls
}

func (i *authInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, conn connect.StreamingHandlerConn) error {
		token := strings.TrimPrefix(conn.RequestHeader().Get("Authorization"), "Bearer ")
		if token == "" {
			return connect.NewError(connect.CodeUnauthenticated, nil)
		}

		info, err := i.auth.authenticate(ctx, token)
		if err != nil || info == nil {
			log.Printf("Auth failed: %v", err)
			return connect.NewError(connect.CodeUnauthenticated, nil)
		}

		ctx = context.WithValue(ctx, authInfoKey, *info)
		return next(ctx, conn)
	}
}

// clerkOnlyInterceptor rejects API key auth — Clerk JWT only.
type clerkOnlyInterceptor struct{}

func newClerkOnlyInterceptor() *clerkOnlyInterceptor {
	return &clerkOnlyInterceptor{}
}

func (i *clerkOnlyInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		info, ok := authInfoFromCtx(ctx)
		if !ok {
			return nil, connect.NewError(connect.CodeUnauthenticated, nil)
		}
		if info.Method != authMethodClerk {
			return nil, connect.NewError(connect.CodePermissionDenied, nil)
		}
		return next(ctx, req)
	}
}

func (i *clerkOnlyInterceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return next
}

func (i *clerkOnlyInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, conn connect.StreamingHandlerConn) error {
		info, ok := authInfoFromCtx(ctx)
		if !ok {
			return connect.NewError(connect.CodeUnauthenticated, nil)
		}
		if info.Method != authMethodClerk {
			return connect.NewError(connect.CodePermissionDenied, nil)
		}
		return next(ctx, conn)
	}
}

// authMiddlewareHTTP wraps an http.Handler with auth, storing authInfo in context.
func (a *authenticator) authMiddlewareHTTP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractBearerToken(r)
		if token == "" {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		info, err := a.authenticate(r.Context(), token)
		if err != nil || info == nil {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), authInfoKey, *info)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
