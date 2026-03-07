package main

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"strings"

	"connectrpc.com/connect"
	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/clerk/clerk-sdk-go/v2/jwks"
	"github.com/clerk/clerk-sdk-go/v2/jwt"
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
	db         *sql.DB
	jwksClient *jwks.Client
	jwkStore   *inMemoryJWKStore
	ensureUser ensureUserFunc
}

type inMemoryJWKStore struct {
	jwk *clerk.JSONWebKey
}

func newAuthenticator(db *sql.DB, clerkSecretKey string) *authenticator {
	config := &clerk.ClientConfig{}
	config.Key = clerk.String(clerkSecretKey)
	return &authenticator{
		db:         db,
		jwksClient: jwks.NewClient(config),
		jwkStore:   &inMemoryJWKStore{},
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
		userID, keyID, err := dbLookupAPIKey(a.db, hash)
		if err != nil {
			return nil, err
		}
		go dbTouchAPIKey(a.db, keyID)
		return &authInfo{UserID: userID, Method: authMethodAPIKey, KeyID: keyID}, nil
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

// newAuthInterceptor returns a Connect interceptor that validates auth.
func newAuthInterceptor(auth *authenticator) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			token := strings.TrimPrefix(req.Header().Get("Authorization"), "Bearer ")
			if token == "" {
				return nil, connect.NewError(connect.CodeUnauthenticated, nil)
			}

			info, err := auth.authenticate(ctx, token)
			if err != nil || info == nil {
				log.Printf("Auth failed: %v", err)
				return nil, connect.NewError(connect.CodeUnauthenticated, nil)
			}

			ctx = context.WithValue(ctx, authInfoKey, *info)
			return next(ctx, req)
		}
	}
}

// newClerkOnlyInterceptor rejects API key auth — Clerk JWT only.
func newClerkOnlyInterceptor() connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
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
