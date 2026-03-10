// gen-llms-txt generates llms.txt from llms.txt.tmpl by embedding actual
// CLI help output. Run via: make llms-txt (from repo root)
package main

import (
	"os"
	"os/exec"
	"strings"
	"text/template"
)

type data struct {
	CLIHelp string
}

func help(bin string, args ...string) string {
	out, _ := exec.Command(bin, append(args, "--help")...).CombinedOutput()
	return strings.TrimRight(string(out), "\n")
}

func main() {
	// Must be run from repo root (where go.work and llms.txt.tmpl live).
	bin, err := os.CreateTemp("", "dazzle-*")
	if err != nil {
		panic(err)
	}
	bin.Close()
	defer os.Remove(bin.Name())

	if out, err := exec.Command("go", "build", "-o", bin.Name(), "./cli/cmd/dazzle").CombinedOutput(); err != nil {
		panic(string(out))
	}

	d := data{
		CLIHelp: help(bin.Name()),
	}

	tmpl, err := template.ParseFiles("llms.txt.tmpl")
	if err != nil {
		panic(err)
	}

	out, err := os.Create("llms.txt")
	if err != nil {
		panic(err)
	}
	defer out.Close()

	if err := tmpl.Execute(out, d); err != nil {
		panic(err)
	}

	// Also copy to web/public/llms.txt
	content, err := os.ReadFile("llms.txt")
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile("web/public/llms.txt", content, 0644); err != nil {
		panic(err)
	}
}
