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
}

func help(bin string, args ...string) string {
	out, _ := exec.Command(bin, append(args, "--help")...).CombinedOutput()
	return strings.TrimRight(string(out), "\n")
}

func main() {
	// Build the CLI binary into a temp file.
	bin, err := os.CreateTemp("", "dazzle-*")
	if err != nil {
		panic(err)
	}
	bin.Close()
	defer os.Remove(bin.Name())

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
	}

	tmpl, err := template.ParseFiles("README.md.tmpl")
	if err != nil {
		panic(err)
	}

	out, err := os.Create("README.md")
	if err != nil {
		panic(err)
	}
	defer out.Close()

	if err := tmpl.Execute(out, d); err != nil {
		panic(err)
	}
}
