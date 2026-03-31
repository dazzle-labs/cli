// gen-readme generates README.md and server.json by embedding actual CLI help
// output and MCP tool metadata.
//
// Usage:
//
//	go run ./cmd/gen-readme              # version from binary ("dev")
//	go run ./cmd/gen-readme 0.5.1        # explicit version override
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"text/template"
)

type mcpTool struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type mcpResource struct {
	URI         string `json:"uri"`
	Description string `json:"description"`
}

type data struct {
	HelpMain            string
	HelpStage           string
	HelpStageSync       string
	HelpStageScreenshot string
	HelpStageEvent      string
	HelpDestination     string
	Version             string
	Tools               []mcpTool
	Resources           []mcpResource
}

func help(bin string, args ...string) string {
	out, _ := exec.Command(bin, append(args, "--help")...).CombinedOutput()
	return strings.TrimRight(string(out), "\n")
}

// resolveVersion returns the version to stamp in generated files.
// If a version was passed as a CLI argument, use that. Otherwise fall back
// to the version baked into the binary (which is "dev" during development).
func resolveVersion(bin string) string {
	if len(os.Args) > 1 {
		return os.Args[1]
	}
	return version(bin)
}

func version(bin string) string {
	out, _ := exec.Command(bin, "version", "--json").CombinedOutput()
	s := string(out)
	if i := strings.Index(s, `"version":"`); i >= 0 {
		s = s[i+len(`"version":"`):]
		if j := strings.Index(s, `"`); j >= 0 {
			return s[:j]
		}
	}
	return "dev"
}

// mcpMeta starts the MCP server, sends initialize + tools/list + resources/list,
// and returns the tool and resource definitions.
func mcpMeta(bin string) ([]mcpTool, []mcpResource) {
	cmd := exec.Command(bin, "mcp")
	cmd.Env = os.Environ()
	stdin, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "warn: could not start MCP server: %v\n", err)
		return nil, nil
	}

	// Send messages and read responses concurrently.
	// The MCP server reads from stdin and writes to stdout in lockstep,
	// so we must not close stdin before reading the responses.
	var tools []mcpTool
	var resources []mcpResource

	// Start reading responses in a goroutine.
	got := make(map[int]bool)
	done := make(chan struct{})
	go func() {
		defer close(done)
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			var rpcMsg struct {
				ID     *int            `json:"id"`
				Result json.RawMessage `json:"result"`
			}
			if err := json.Unmarshal([]byte(line), &rpcMsg); err != nil || rpcMsg.ID == nil {
				continue
			}

			switch *rpcMsg.ID {
			case 2: // tools/list
				var result struct {
					Tools []struct {
						Name        string `json:"name"`
						Description string `json:"description"`
					} `json:"tools"`
				}
				if err := json.Unmarshal(rpcMsg.Result, &result); err == nil {
					for _, t := range result.Tools {
						tools = append(tools, mcpTool{Name: t.Name, Description: t.Description})
					}
				}
				got[2] = true
			case 3: // resources/list
				var result struct {
					Resources []struct {
						URI         string `json:"uri"`
						Name        string `json:"name"`
						Description string `json:"description"`
					} `json:"resources"`
				}
				if err := json.Unmarshal(rpcMsg.Result, &result); err == nil {
					for _, r := range result.Resources {
						resources = append(resources, mcpResource{URI: r.URI, Description: r.Description})
					}
				}
				got[3] = true
			}

			// Got both responses — we're done.
			if got[2] && got[3] {
				return
			}
		}
	}()

	// Send JSON-RPC messages.
	messages := []string{
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"gen-readme","version":"1.0"}}}`,
		`{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`,
		`{"jsonrpc":"2.0","id":3,"method":"resources/list","params":{}}`,
	}
	for _, msg := range messages {
		fmt.Fprintln(stdin, msg) //nolint:errcheck
	}

	// Wait for responses, then clean up.
	<-done
	stdin.Close() //nolint:errcheck
	_ = cmd.Wait()
	return tools, resources
}

func generate(tmplFile, outFile string, d data) {
	tmpl, err := template.ParseFiles(tmplFile)
	if err != nil {
		panic(err)
	}
	out, err := os.Create(outFile)
	if err != nil {
		panic(err)
	}
	defer out.Close() //nolint:errcheck
	if err := tmpl.Execute(out, d); err != nil {
		panic(err)
	}
}

func main() {
	// Build the CLI binary into a temp file.
	bin, err := os.CreateTemp("", "dazzle-*")
	if err != nil {
		panic(err)
	}
	_ = bin.Close()
	defer os.Remove(bin.Name()) //nolint:errcheck

	if out, err := exec.Command("go", "build", "-o", bin.Name(), "./cmd/dazzle").CombinedOutput(); err != nil {
		panic(string(out))
	}

	tools, resources := mcpMeta(bin.Name())

	d := data{
		HelpMain:            help(bin.Name()),
		HelpStage:           help(bin.Name(), "stage"),
		HelpStageSync:       help(bin.Name(), "stage", "sync"),
		HelpStageScreenshot: help(bin.Name(), "stage", "screenshot"),
		HelpStageEvent:      help(bin.Name(), "stage", "event"),
		HelpDestination:     help(bin.Name(), "destination"),
		Version:             resolveVersion(bin.Name()),
		Tools:               tools,
		Resources:           resources,
	}

	generate("README.md.tmpl", "README.md", d)
	generateServerJSON("server.json", d)
}

// serverJSON is the structure written to server.json.
type serverJSON struct {
	Schema      string           `json:"$schema"`
	Name        string           `json:"name"`
	Description string           `json:"description"`
	Version     string           `json:"version"`
	Repository  serverRepo       `json:"repository"`
	Packages    []serverPackage  `json:"packages"`
	Tools       []mcpTool        `json:"tools"`
	Resources   []mcpResource    `json:"resources"`
}

type serverRepo struct {
	URL    string `json:"url"`
	Source string `json:"source"`
}

type serverPackage struct {
	RegistryName string `json:"registry_name"`
	Name         string `json:"name"`
	Version      string `json:"version"`
}

func generateServerJSON(outFile string, d data) {
	s := serverJSON{
		Schema:      "https://registry.modelcontextprotocol.io/schemas/server.json",
		Name:        "io.github.dazzle-labs/dazzle",
		Description: "Cloud stages for AI agents and live streaming. Create, manage, and sync content to browser-based streaming environments.",
		Version:     d.Version,
		Repository: serverRepo{
			URL:    "https://github.com/dazzle-labs/cli",
			Source: "https://github.com/dazzle-labs/cli/tree/main/cmd/dazzle",
		},
		Packages: []serverPackage{{
			RegistryName: "github-releases",
			Name:         "dazzle-labs/cli",
			Version:      "v" + d.Version,
		}},
		Tools:     d.Tools,
		Resources: d.Resources,
	}

	out, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		panic(err)
	}
	out = append(out, '\n')
	if err := os.WriteFile(outFile, out, 0644); err != nil {
		panic(err)
	}
}
