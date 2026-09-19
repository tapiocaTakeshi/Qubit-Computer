# QubitOS / Qubit Computer for Homebrew: the Python package and its `qubitos` shell.
#
#   brew tap tapiocatakeshi/qubit-computer https://github.com/tapiocaTakeshi/Qubit-Computer
#   brew install --HEAD tapiocatakeshi/qubit-computer/qubit-computer
#   qubitos
#
# The formula is head-only because the project has no tagged release yet. Once a tag exists, add a
# stable stanza above `head` and drop the --HEAD flag from the commands above:
#
#   url "https://github.com/tapiocaTakeshi/Qubit-Computer/archive/refs/tags/v0.1.0.tar.gz"
#   sha256 "…"   # shasum -a 256 of that tarball
class QubitComputer < Formula
  include Language::Python::Virtualenv

  desc "Quantum computer simulator built on APQBs, with the QubitOS shell"
  homepage "https://github.com/tapiocaTakeshi/Qubit-Computer"
  license "MIT"
  head "https://github.com/tapiocaTakeshi/Qubit-Computer.git", branch: "main"

  depends_on "python@3.13"

  # The package is pure Python and depends on nothing outside the standard library, so the
  # virtualenv has no resources to fetch.
  def install
    virtualenv_install_with_resources
  end

  def caveats
    <<~EOS
      Start the OS with:
        qubitos                        interactive qsh shell
        qubitos -c "run bell"          run a command and exit
        qubitos --fs ~/.qubitos.json   keep QubitFS between sessions

      Inside qsh, the `claude` command hands off to the Claude Code CLI, if you also
      have it installed (e.g. `brew install claude-code`):
        qubitos:/$ claude -p "explain this repo"

      The desktop version of QubitOS is a separate download; see the project README.
    EOS
  end

  test do
    assert_match "QubitOS", shell_output("#{bin}/qubitos -c uname")
    assert_match "shots=16", shell_output("#{bin}/qubitos -c 'run bell --shots 16 --seed 1'")
    (testpath/"boot.qsh").write("alloc 2 --name t\ngate 1 h 0\nreadout 1\n")
    assert_match "r=<Z>", shell_output("#{bin}/qubitos --quiet #{testpath}/boot.qsh")
  end
end
