// gen-llms-txt generates llms.txt and llms-full.txt from templates by
// embedding actual CLI help output. Run via: make llms-txt (from repo root)
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

func generate(tmplFile, outFile, webFile string, d data) {
	tmpl, err := template.ParseFiles(tmplFile)
	if err != nil {
		panic(err)
	}

	out, err := os.Create(outFile)
	if err != nil {
		panic(err)
	}
	defer out.Close()

	if err := tmpl.Execute(out, d); err != nil {
		panic(err)
	}

	content, err := os.ReadFile(outFile)
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile(webFile, content, 0644); err != nil {
		panic(err)
	}
}

func main() {
	// Must be run from repo root (where go.work and templates live).
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

	generate("llms.txt.tmpl", "llms.txt", "web/public/llms.txt", d)
	generate("llms-full.txt.tmpl", "llms-full.txt", "web/public/llms-full.txt", d)
	generate("cli-reference.txt.tmpl", "cli-reference.txt", "web/public/cli-reference.txt", d)
}
