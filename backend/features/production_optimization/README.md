# Production Optimization Domain (`backend/features/production_optimization`)

## 1. Domain Overview & Purpose
The **Production Optimization** module maximizes plant throughput, balances multi-stage assembly lines, eliminates work-in-progress (WIP) bottlenecks, and computes real-time **Overall Equipment Effectiveness (OEE)**. It enables dynamic dispatching and schedule rebalancing when unexpected line disruptions occur.

---

## 2. Domain Models & Mathematical Foundations

### Core Entities & Value Objects (`domain/`)
- `OEEMetrics`:
  $$\text{OEE} = \text{Availability} \times \text{Performance} \times \text{Quality}$$
  - $\text{Availability} = \frac{\text{Operating Time}}{\text{Planned Production Time}}$
  - $\text{Performance} = \frac{\text{Ideal Cycle Time} \times \text{Total Count}}{\text{Operating Time}}$
  - $\text{Quality} = \frac{\text{Good Count}}{\text{Total Count}}$
- `BottleneckStation`: Machine identified as constraining total line throughput based on buffer starvation/blocking and highest cycle time variance.
- `Little's Law`: $WIP = TH \times CT$ (Work in Progress = Throughput × Cycle Time).
- `ProductionSchedule`: Sequence of production lots assigned to lines with changeover intervals.

---

## 3. Ports & Contracts (`ports/`)

### Driving Ports (`ports/input/`)
- `IProductionOptimizationUseCase`:
  - `compute_oee(line_id: str, window_minutes: int) -> OEEMetrics`
  - `identify_line_bottlenecks(line_id: str) -> list[BottleneckStation]`
  - `optimize_dispatch_schedule(target_orders: list[Order]) -> OptimizedSchedule`

### Driven Ports (`ports/output/`)
- `ILineStateRepository`: Queries active line speeds, machine states, and buffer occupancy.
- `ISolverAdapter`: Solves Mixed-Integer Linear Programming (MILP) or constraint optimization models (using OR-Tools or scipy).
- `IMESScheduleEmitter`: Dispatches approved production sequences to the MES layer.

---

## 4. MCP Tools & Agent Interfaces
- `get_line_oee(line_id)`: Returns current OEE components and historical benchmark.
- `detect_bottleneck(line_id)`: Pinpoints the active production constraint.
- `simulate_line_rebalance(line_id, proposed_speeds)`: Simulates throughput impact of speed/allocation changes.
