// gen-readme generates README.md from README.md.tmpl by embedding actual
// CLI help output. Run via: make readme
package main

import (
	"os"
	"os/exec"
	"strings"
	"text/template"
)

type data struct {
	HelpMain            string
	HelpStage           string
	HelpStageSync       string
	HelpStageScreenshot string
	HelpStageEvent      string
	HelpDestination     string
	Version             string
}

func help(bin string, args ...string) string {
	out, _ := exec.Command(bin, append(args, "--help")...).CombinedOutput()
	return strings.TrimRight(string(out), "\n")
}

func version(bin string) string {
	out, _ := exec.Command(bin, "version", "--json").CombinedOutput()
	// Extract version string — output is JSON like {"version":"0.5.0",...}
	s := string(out)
	if i := strings.Index(s, `"version":"`); i >= 0 {
		s = s[i+len(`"version":"`):]
		if j := strings.Index(s, `"`); j >= 0 {
			return s[:j]
		}
	}
	return "dev"
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

	d := data{
		HelpMain:            help(bin.Name()),
		HelpStage:           help(bin.Name(), "stage"),
		HelpStageSync:       help(bin.Name(), "stage", "sync"),
		HelpStageScreenshot: help(bin.Name(), "stage", "screenshot"),
		HelpStageEvent:      help(bin.Name(), "stage", "event"),
		HelpDestination:     help(bin.Name(), "destination"),
		Version:             version(bin.Name()),
	}

	generate("README.md.tmpl", "README.md", d)
	generate("server.json.tmpl", "server.json", d)
}
