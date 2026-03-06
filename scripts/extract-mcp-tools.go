// Extract MCP tool definitions from control-plane/mcp.go using Go AST parsing.
// Outputs markdown to stdout with tool name, description, and parameters.
//
// Usage: go run scripts/extract-mcp-tools.go
package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strconv"
	"strings"
)

type param struct {
	Name     string
	Type     string // "string", "number", "array"
	Required bool
	Desc     string
}

type tool struct {
	Name   string
	Desc   string
	Params []param
}

func main() {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, "control-plane/mcp.go", nil, 0)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: failed to parse mcp.go: %v\n", err)
		os.Exit(1)
	}

	var tools []tool

	// Walk the AST looking for s.AddTool calls
	ast.Inspect(f, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}

		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != "AddTool" {
			return true
		}

		if len(call.Args) < 2 {
			return true
		}

		// First arg is mcp.NewTool(...)
		newToolCall, ok := call.Args[0].(*ast.CallExpr)
		if !ok {
			return true
		}

		t := parseTool(newToolCall)
		if t.Name != "" {
			tools = append(tools, t)
		}
		return true
	})

	if len(tools) == 0 {
		fmt.Fprintln(os.Stderr, "ERROR: no tools found in mcp.go")
		os.Exit(1)
	}

	for _, t := range tools {
		fmt.Printf("#### %s\n", t.Name)
		fmt.Println(t.Desc)
		fmt.Println()
		if len(t.Params) > 0 {
			fmt.Println("**Parameters:**")
			for _, p := range t.Params {
				req := "(optional)"
				if p.Required {
					req = "(required)"
				}
				fmt.Printf("- `%s` %s %s — %s\n", p.Name, req, p.Type, p.Desc)
			}
			fmt.Println()
		}
	}
}

func parseTool(call *ast.CallExpr) tool {
	var t tool
	if len(call.Args) < 1 {
		return t
	}

	// First arg is the tool name
	t.Name = unquote(call.Args[0])

	// Remaining args are mcp.With* options
	for _, arg := range call.Args[1:] {
		optCall, ok := arg.(*ast.CallExpr)
		if !ok {
			continue
		}
		sel, ok := optCall.Fun.(*ast.SelectorExpr)
		if !ok {
			continue
		}
		switch sel.Sel.Name {
		case "WithDescription":
			if len(optCall.Args) > 0 {
				t.Desc = unquote(optCall.Args[0])
			}
		case "WithString":
			p := parseParam(optCall, "string")
			if p.Name != "" {
				t.Params = append(t.Params, p)
			}
		case "WithNumber":
			p := parseParam(optCall, "number")
			if p.Name != "" {
				t.Params = append(t.Params, p)
			}
		case "WithArray":
			p := parseParam(optCall, "array")
			if p.Name != "" {
				t.Params = append(t.Params, p)
			}
		case "WithObject":
			p := parseParam(optCall, "object")
			if p.Name != "" {
				t.Params = append(t.Params, p)
			}
		}
	}
	return t
}

func parseParam(call *ast.CallExpr, typ string) param {
	var p param
	p.Type = typ
	if len(call.Args) < 1 {
		return p
	}

	p.Name = unquote(call.Args[0])

	for _, arg := range call.Args[1:] {
		argCall, ok := arg.(*ast.CallExpr)
		if !ok {
			continue
		}
		sel, ok := argCall.Fun.(*ast.SelectorExpr)
		if !ok {
			continue
		}
		switch sel.Sel.Name {
		case "Required":
			p.Required = true
		case "Description":
			if len(argCall.Args) > 0 {
				p.Desc = unquote(argCall.Args[0])
			}
		}
	}
	return p
}

// unquote extracts the string value from a basic literal or composite expression.
func unquote(expr ast.Expr) string {
	switch e := expr.(type) {
	case *ast.BasicLit:
		if e.Kind == token.STRING {
			s, err := strconv.Unquote(e.Value)
			if err != nil {
				// Try raw string (backtick)
				return strings.Trim(e.Value, "`")
			}
			return s
		}
	}
	// For backtick strings, the parser returns them as BasicLit with backticks
	return ""
}
