# Waste Reduction & Sustainability Domain (`backend/features/waste_reduction`)

## 1. Domain Overview & Purpose
The **Waste Reduction** module analyzes manufacturing scrap, pinpoints upstream physical root causes, tracks machine energy waste, and computes unit-level greenhouse gas (GHG) carbon footprints. It transforms scrap and energy losses into actionable operational targets.

---

## 2. Domain Models & Mathematical Foundations

### Core Entities & Value Objects (`domain/`)
- `ScrapAttribution`: Quantitative attribution of rejected parts to specific upstream root causes:
  - Baseline process yield loss
  - Mechanical wear (e.g. bearing play causing tooling jitter)
  - Thermal drift (e.g. solder bath temperature drops)
  - Material defect (inbound supplier batch defect)
- `EnergyWasteProfile`:
  $$E_{\text{total}} = E_{\text{useful}} + E_{\text{idle}} + E_{\text{friction}}$$
  - $E_{\text{idle}}$: Machine powered and drawing baseline kW without producing parts.
  - $E_{\text{friction}}$: Excess kWh drawn due to bearing mechanical resistance or lack of lubrication.
- `CarbonFootprint`: Embodied Scope 1 (direct fuel/gas) and Scope 2 (grid electricity) emissions ($kg\ CO_2e$) per good unit produced.

---

## 3. Ports & Contracts (`ports/`)

### Driving Ports (`ports/input/`)
- `IWasteReductionUseCase`:
  - `attribute_scrap_causes(line_id: str, time_window: TimeRange) -> ScrapAttributionReport`
  - `detect_energy_waste(asset_id: str) -> EnergyWasteAssessment`
  - `calculate_product_carbon_intensity(product_id: str) -> CarbonIntensityReport`

### Driven Ports (`ports/output/`)
- `IScrapEventRepository`: Logs quality rejects and station inspection failure events.
- `IPowerMeterTelemetryAdapter`: Reads sub-second active power (kW) and power factor measurements.
- `IEmissionFactorProvider`: Provides regional grid carbon intensity coefficients ($g\ CO_2e / kWh$).

---

## 4. MCP Tools & Agent Interfaces
- `get_scrap_attribution(line_id)`: Breaks down scrap count by upstream machine and physical root cause.
- `audit_machine_energy_waste(asset_id)`: Detects unnecessary idle power draw and mechanical drag.
- `compute_lot_carbon_footprint(order_id)`: Calculates total $kg\ CO_2e$ embodied in an order.
