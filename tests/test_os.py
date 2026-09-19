import json
import math
import os
import tempfile
import unittest
from unittest import mock

from qubit_computer.os import Kernel, KernelError, ProcState, QubitFS, Shell, boot
from qubit_computer.os.boot import main


class Capture:
    def __init__(self):
        self.lines = []

    def __call__(self, s):
        self.lines.append(str(s))

    @property
    def text(self):
        return "\n".join(self.lines)


class TestFS(unittest.TestCase):
    def test_basic_ops_and_persistence(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "fs.json")
            fs = QubitFS(path)
            fs.mkdir("/home/user/work")
            fs.write("/home/user/work/a.txt", "hello")
            fs.cd("/home/user")
            self.assertEqual(fs.read("work/a.txt"), "hello")
            self.assertIn("work/", fs.ls())
            fs.sync()
            fs2 = QubitFS(path)
            self.assertEqual(fs2.read("/home/user/work/a.txt"), "hello")
            with self.assertRaises(Exception):
                fs2.rm("/home/user/work")
            fs2.rm("/home/user/work", recursive=True)
            self.assertFalse(fs2.exists("/home/user/work"))


class TestKernel(unittest.TestCase):
    def setUp(self):
        self.k = Kernel(num_qubits=6, seed=0, theta=0.0)

    def test_memory_allocation(self):
        s1 = self.k.sys_alloc(4, "a")
        s2 = self.k.sys_alloc(2, "b")
        self.assertEqual(s1.qubits, [0, 1, 2, 3])
        self.assertEqual(s2.qubits, [4, 5])
        with self.assertRaises(KernelError):
            self.k.sys_alloc(1)
        self.k.sys_free(s1.sid)
        self.assertEqual(self.k.sys_mem()["free"], 4)

    def test_register_syscalls(self):
        seg = self.k.sys_alloc(2, "pair")
        self.k.sys_apply(seg.sid, "apqb", [0], [0.4])
        self.k.sys_apply(seg.sid, "cx", [0, 1])
        ent = self.k.sys_entanglement(seg.sid)
        self.assertAlmostEqual(ent["concurrence"], abs(math.sin(0.8)))
        out = self.k.sys_measure(seg.sid)
        self.assertIn(out["outcome"], ("00", "11"))
        self.assertAlmostEqual(seg.state.probability_of(out["outcome"]), 1.0)

    def test_process_lifecycle(self):
        proc = self.k.sys_run("bell", shots=10, seed=1)
        self.assertEqual(proc.state, ProcState.DONE)
        self.assertEqual(sum(proc.result.counts.values()), 10)
        self.assertTrue(self.k.fs.exists(f"/var/results/{proc.pid}_bell.json"))
        bad = self.k.sys_run("grover", ["10101010"])  # 8 qubits > 6 physical
        self.assertEqual(bad.state, ProcState.FAILED)
        self.assertIn("qubits", bad.error)

    def test_priority_scheduler_deterministic_at_theta_zero(self):
        self.k.sys_spawn("bell", priority=1)
        self.k.sys_spawn("ghz", ["3"], priority=9)
        self.k.sys_spawn("bell_apqb", ["0.2"], priority=5)
        self.assertEqual(self.k.exploration_rate(), 0.0)
        done = self.k.sys_schedule()
        self.assertEqual([p.name for p in done], ["ghz", "bell_apqb", "bell"])

    def test_apqb_scheduler_explores_at_theta_pi_over_4(self):
        k = Kernel(num_qubits=4, seed=5, theta=math.pi / 4)
        self.assertAlmostEqual(k.exploration_rate(), 0.5)
        orders = set()
        for trial in range(20):
            k2 = Kernel(num_qubits=4, seed=trial, theta=math.pi / 4)
            for name, prio in (("bell", 1), ("ghz", 9), ("bell_apqb", 5)):
                k2.sys_spawn(name, priority=prio)
            orders.add(tuple(p.name for p in k2.sys_schedule()))
        self.assertGreater(len(orders), 1)

    def test_kill_and_sysctl(self):
        proc = self.k.sys_spawn("bell")
        self.k.sys_kill(proc.pid)
        self.assertEqual(proc.state, ProcState.KILLED)
        self.assertEqual(self.k.sys_schedule(), [])
        self.k.sys_sysctl("apqb.theta", "0.5")
        self.assertAlmostEqual(self.k.exploration_rate(), 0.5 * abs(math.sin(1.0)))
        with self.assertRaises(KernelError):
            self.k.sys_sysctl("apqb.theta", "3")

    def test_qbnn_job(self):
        proc = self.k.sys_run("qbnn_train", ["xor", "--epochs", "40", "--seed", "1"])
        self.assertEqual(proc.state, ProcState.DONE, proc.error)
        self.assertEqual(proc.result["accuracy"], 1.0)
        ev = self.k.sys_run("qbnn_eval", [proc.result["weights"], "1", "-1"])
        self.assertGreater(ev.result["output"][0], 0.5)


class TestShell(unittest.TestCase):
    def run_cmds(self, cmds, **kw):
        cap = Capture()
        k = Kernel(num_qubits=8, seed=1, **kw)
        sh = Shell(k, out=cap)
        for c in cmds:
            sh.execute_line(c)
        return sh, cap

    def test_run_and_ent(self):
        sh, cap = self.run_cmds(["run bell_apqb 0.3 --shots 20 --seed 2", "ent last"])
        self.assertEqual(sh.last_status, 0)
        self.assertIn("concurrence", cap.text)
        self.assertIn("satisfied", cap.text)

    def test_program_name_as_command(self):
        sh, cap = self.run_cmds(["bell --shots 5"])
        self.assertIn("== bell", cap.text)

    def test_unknown_command_status(self):
        sh, cap = self.run_cmds(["frobnicate"])
        self.assertEqual(sh.last_status, 127)

    def test_register_workflow(self):
        sh, cap = self.run_cmds([
            "alloc 2 --name pair --r 0.6,-0.2", "readout 1", "gate 1 cx 0 1",
            "measure 1 --shots 10", "measure 1", "free 1", "mem",
        ])
        self.assertEqual(sh.last_status, 0)
        self.assertIn("register collapsed", cap.text)
        self.assertIn("free 8", cap.text)

    def test_files_and_exec(self):
        sh, cap = self.run_cmds([
            "run bell --shots 5", "save last /home/user/b.json", "exec /home/user/b.json --shots 7 --seed 1",
            "cat /home/user/b.json", "tree /home", "sh /home/user/hello.qsh",
        ])
        self.assertEqual(sh.last_status, 0)
        self.assertIn('"gate": "cx"', cap.text)
        self.assertIn("bell_apqb", cap.text)

    def test_apqb_command(self):
        sh, cap = self.run_cmds(["apqb --r 0.5", "apqb 0.25pi", "sysctl apqb.theta 0.4", "sysctl"])
        self.assertIn("r = cos2θ = +0.5000", cap.text)
        self.assertIn("apqb.theta = 0.4", cap.text)

    def test_semicolons_and_quotes(self):
        sh, cap = self.run_cmds(['echo "a; b"; echo c'])
        self.assertEqual(cap.lines, ["a; b", "c"])

    def test_claude_not_found(self):
        with mock.patch("qubit_computer.os.shell.shutil.which", return_value=None):
            sh, cap = self.run_cmds(["claude --version"])
        self.assertEqual(sh.last_status, 1)
        self.assertIn("claude: command not found", cap.text)
        self.assertIn("brew install claude-code", cap.text)

    def test_claude_handoff(self):
        with mock.patch("qubit_computer.os.shell.shutil.which", return_value="/opt/homebrew/bin/claude"), \
                mock.patch("qubit_computer.os.shell.subprocess.call", return_value=0) as call:
            sh, cap = self.run_cmds(["claude -p hello"])
        call.assert_called_once_with(["/opt/homebrew/bin/claude", "-p", "hello"])
        self.assertEqual(sh.last_status, 0)

    def test_claude_nonzero_exit(self):
        with mock.patch("qubit_computer.os.shell.shutil.which", return_value="/usr/bin/claude"), \
                mock.patch("qubit_computer.os.shell.subprocess.call", return_value=2):
            sh, cap = self.run_cmds(["claude"])
        self.assertEqual(sh.last_status, 1)
        self.assertIn("claude exited with status 2", cap.text)


class TestBoot(unittest.TestCase):
    def test_main_command_mode(self):
        status = main(["-c", "uname; run bell --shots 3 --seed 1", "--quiet"])
        self.assertEqual(status, 0)

    def test_main_script_mode_with_persistent_fs(self):
        with tempfile.TemporaryDirectory() as d:
            script = os.path.join(d, "s.qsh")
            fs = os.path.join(d, "fs.json")
            with open(script, "w") as fh:
                fh.write("write /home/user/note.txt persisted\nrun bell --shots 2\n")
            self.assertEqual(main([script, "--fs", fs, "--quiet"]), 0)
            self.assertEqual(QubitFS(fs).read("/home/user/note.txt").strip(), "persisted")


if __name__ == "__main__":
    unittest.main()
