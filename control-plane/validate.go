package main

import (
	"fmt"
	"regexp"
	"strings"

	"connectrpc.com/connect"
)

const maxNameLen = 64

// validNameRe allows letters, digits, hyphens, underscores, spaces, and periods.
var validNameRe = regexp.MustCompile(`^[a-zA-Z0-9 _.\-]+$`)

// validateName checks that a user-supplied name (stage, destination, API key)
// contains only safe characters and is within length limits.
func validateName(name string) error {
	if len(name) > maxNameLen {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("name too long (max %d characters)", maxNameLen))
	}
	if !validNameRe.MatchString(name) {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("name contains invalid characters (only letters, numbers, hyphens, underscores, spaces, and periods are allowed)"))
	}
	return nil
}

// validSlugRe allows lowercase letters, digits, and hyphens.
var validSlugRe = regexp.MustCompile(`^[a-z0-9\-]+$`)

// validateSlug checks that a slug contains only URL-safe characters.
func validateSlug(slug string) error {
	slug = strings.TrimSpace(slug)
	if len(slug) > maxNameLen {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("slug too long (max %d characters)", maxNameLen))
	}
	if !validSlugRe.MatchString(slug) {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("slug must contain only lowercase letters, numbers, and hyphens"))
	}
	return nil
}
