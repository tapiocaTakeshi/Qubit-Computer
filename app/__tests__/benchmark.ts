import { QubitComputer, Circuit, algorithms } from '../src/core/index';

describe('Performance Benchmark', () => {
  const benchmark = async (name: string, func: () => void, iterations = 1): Promise<number> => {
    const times: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      func();
      const elapsed = performance.now() - start;
      times.push(elapsed);
    }
    return times.reduce((a, b) => a + b) / times.length;
  };

  test('state vector scaling and algorithms', async () => {
    console.log('='.repeat(70));
    console.log('QUBIT COMPUTER PERFORMANCE BENCHMARK (TypeScript)');
    console.log('='.repeat(70));

    console.log('\n[1] STATE VECTOR SIZE SCALING');
    console.log('-'.repeat(70));
    for (const n_qubits of [4, 8, 12, 16, 18, 20]) {
      const test = () => {
        const circuit = new Circuit(n_qubits);
        circuit.h(0);
        for (let i = 1; i < n_qubits; i++) {
          circuit.cx(0, i);
        }
        const computer = new QubitComputer(n_qubits);
        computer.run(circuit, 1);
      };
      
      const avg = await benchmark(`GHZ(${n_qubits}q)`, test, 3);
      const state_size = 2**n_qubits;
      const amp_bytes = state_size * 16;
      const size_mb = amp_bytes / 1024 / 1024;
      console.log(`GHZ(${String(n_qubits).padStart(2)}) ${avg.toFixed(2).padStart(8)}ms | ${state_size.toString().padStart(7)} amps | ${size_mb.toFixed(1).padStart(6)}MB`);
    }

    console.log('\n[2] GATE OPERATION OVERHEAD (8 qubits)');
    console.log('-'.repeat(70));
    for (const n_gates of [10, 50, 100, 200]) {
      const test = () => {
        const circuit = new Circuit(8);
        for (let i = 0; i < n_gates; i++) {
          circuit.h(0);
          circuit.cx(0, 1);
          circuit.rz(0.5, 2);
        }
        const computer = new QubitComputer(8);
        computer.run(circuit, 1);
      };
      
      const avg = await benchmark(`Chain(${n_gates} gates)`, test, 3);
      const overhead = n_gates > 0 ? avg / n_gates : 0;
      console.log(`Chain(${String(n_gates).padStart(3)} gates) ${avg.toFixed(2).padStart(8)}ms | ${overhead.toFixed(3).padStart(6)}ms/gate`);
    }

    console.log('\n[3] ALGORITHM PERFORMANCE');
    console.log('-'.repeat(70));

    const test_bell = () => {
      const circuit = algorithms.bell();
      const computer = new QubitComputer(2);
      computer.run(circuit, 1000);
    };
    const avg_bell = await benchmark('Bell (2q, 1000 shots)', test_bell, 5);
    console.log(`Bell (2q, 1000 shots)    ${avg_bell.toFixed(2).padStart(8)}ms`);

    const test_grover3 = () => {
      const circuit = algorithms.grover(3, '011');
      const computer = new QubitComputer(3);
      computer.run(circuit, 1);
    };
    const avg_grover3 = await benchmark('Grover (3q)', test_grover3, 5);
    console.log(`Grover (3q)              ${avg_grover3.toFixed(2).padStart(8)}ms`);

    const test_qft8 = () => {
      const circuit = algorithms.qft(8);
      const computer = new QubitComputer(8);
      computer.run(circuit, 1);
    };
    const avg_qft8 = await benchmark('QFT (8q)', test_qft8, 3);
    console.log(`QFT (8q)                 ${avg_qft8.toFixed(2).padStart(8)}ms`);

    const test_qft12 = () => {
      const circuit = algorithms.qft(12);
      const computer = new QubitComputer(12);
      computer.run(circuit, 1);
    };
    const avg_qft12 = await benchmark('QFT (12q)', test_qft12, 2);
    console.log(`QFT (12q)                ${avg_qft12.toFixed(2).padStart(8)}ms`);

    console.log('\n[4] MEASUREMENT & READOUT');
    console.log('-'.repeat(70));
    for (const n_qubits of [8, 12, 16]) {
      const test = () => {
        const circuit = new Circuit(n_qubits);
        for (let q = 0; q < n_qubits; q++) {
          circuit.h(q);
        }
        const computer = new QubitComputer(n_qubits);
        computer.run(circuit, 1000);
      };
      
      const avg = await benchmark(`Measure(${n_qubits}q)`, test, 3);
      const per_shot = avg / 1000;
      console.log(`Measure(${String(n_qubits).padStart(2)}q, 1000 shots) ${avg.toFixed(2).padStart(8)}ms | ${(per_shot*1000).toFixed(3).padStart(7)}µs/shot`);
    }

    console.log('\n' + '='.repeat(70));
  }, 120000);
});
