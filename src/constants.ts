import type { EventTableEntry, FacilityProfile } from "./types.js";

let idCounter = 0;
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter.toString(36)}`;
}

// The one hardcoded starting preset. 50 diesel buses split across route
// tiers below — the fleet sits idle midday between AM/PM runs, which is
// exactly the charging window a real electrification plan would exploit.
export const SCHOOL_BUS_DEPOT_PRESET: FacilityProfile = {
  name: "Meridian Unified School Bus Depot",
  facilityType: "school_bus_depot",
  location: {
    state: "Ohio",
    utility: "AEP Ohio",
    climateZone: {
      key: "5A",
      label: "5A (Mixed-Humid)",
      solarYieldFactor: 1_250, // placeholder kWh/kW/yr for a mixed-humid Ohio climate — not real climate data
      // Real NOAA 1991-2020 climate normals for Columbus, OH (representative
      // of this preset's AEP Ohio service territory) — see ClimateZone's own
      // doc comment in types.ts. Derived by hand from NOAA's published
      // monthly average high/low normals, not looked up as a single figure:
      //   meanAnnualTempF = average of the 12 monthly means ((high+low)/2)
      //   seasonalAmplitudeF = (July mean 75°F − January mean 30°F) / 2
      //   dailyAmplitudeF = average of the 12 monthly (high−low) diurnal
      //     ranges, halved
      // Source: NOAA NCEI 1991-2020 U.S. Climate Normals, Columbus OH
      // (station USW00093812), via currentresults.com's published summary
      // of that dataset.
      meanAnnualTempF: 53.4,
      seasonalAmplitudeF: 22.5,
      dailyAmplitudeF: 9.2,
      // Real elevation, Columbus, OH (~889 ft) — closes seam_reconnaissance.md
      // §7's second residual gap alongside solarIrradianceWPerM2 below.
      altitudeFt: 889,
      // Placeholder — no real Columbus-specific peak-irradiance figure
      // sourced, matching every ev-thermal-sim reference profile's own
      // convention for this field. Not the same quantity as
      // solarYieldFactor above — see ClimateZone's own doc comment.
      solarIrradianceWPerM2: 250,
    },
  },
  electrical: {
    serviceVoltage: 480,
    serviceAmps: 400,
    phaseType: "three_phase",
    // 15% is the classic simplified "fast track" interconnection screening
    // threshold many utilities use — a placeholder stand-in for a real study.
    interconnectionHeadroom: 0.15,
  },
  site: {
    roofSqFt: 18_000,
    bays: [
      { id: "bay_1", label: "Bay 1", hasCharger: true },
      { id: "bay_2", label: "Bay 2", hasCharger: true },
      { id: "bay_3", label: "Bay 3", hasCharger: false },
      { id: "bay_4", label: "Bay 4", hasCharger: false },
      { id: "bay_5", label: "Bay 5", hasCharger: false },
      { id: "bay_6", label: "Bay 6", hasCharger: false },
    ],
  },
  fleet: {
    totalVehicles: 50,
    vehicleClasses: [
      {
        class: "school_bus",
        count: 50,
        avgAnnualMileage: 70 * 180, // 70mi/day × ~180 school days/year — placeholder, not a real ridership study
        currentFuelType: "diesel",
        replacementCycleYears: 12, // placeholder pending real fleet-management data
      },
    ],
    // Placeholder split of the 50-bus fleet across route tiers — not a real
    // routing study. The Special Ed route's small vehicle count doubles as
    // the realistic "start with a small pilot route" pattern real districts
    // actually follow when electrifying.
    routes: [
      { id: "route_elementary", label: "Elementary AM/PM", dailyMiles: 55, dedicatedVehicleCount: 20, evViable: true, converted: false, conversionCompletionOrdinal: null },
      { id: "route_middle", label: "Middle School", dailyMiles: 75, dedicatedVehicleCount: 15, evViable: true, converted: false, conversionCompletionOrdinal: null },
      { id: "route_high", label: "High School", dailyMiles: 95, dedicatedVehicleCount: 12, evViable: true, converted: false, conversionCompletionOrdinal: null },
      { id: "route_specialed", label: "Special Education / Door-to-Door", dailyMiles: 110, dedicatedVehicleCount: 3, evViable: true, converted: false, conversionCompletionOrdinal: null },
    ],
    // Relocated from the old global constants (ELECTRIC_BUS_COST_PLACEHOLDER,
    // DIESEL_SAVINGS_PER_VEHICLE_MONTHLY_PLACEHOLDER,
    // CHARGING_DEMAND_PER_VEHICLE_KW_PLACEHOLDER) — this preset's numbers are
    // UNCHANGED, only their location moved, fixing audit finding #1 from the
    // preset-generalization pass (every preset used to share these figures).
    vehicleEconomics: {
      costPerVehiclePlaceholder: 375_000, // $ per vehicle — placeholder pending real OEM quotes; electric school buses currently run roughly 2.5-3x a diesel bus
      // Built up from independent placeholder assumptions, not
      // reverse-engineered from any DSCR target:
      //   diesel fuel: 7 mpg placeholder × $3.85/gal placeholder ≈ $0.55/mi
      //   electric "fuel": 2.0 kWh/mi placeholder × the facility's own
      //     operatingBaseline.electricityRatePerKWhPlaceholder ($0.13/kWh)
      //     ≈ $0.26/mi
      //   → fuel savings ≈ $0.29/mi
      //   diesel maintenance: ~$0.15/mi placeholder (engine oil, DEF fluid,
      //     emissions systems) vs electric ~$0.05/mi placeholder (tires/brakes
      //     only — no engine service, and regen braking reduces wear)
      //   → maintenance savings ≈ $0.10/mi
      //   combined ≈ $0.39/mi × 1,050 mi/month (avgAnnualMileage ÷ 12, from
      //   this preset's vehicleClasses entry) ≈ $410/month per converted bus.
      // Every input above is a placeholder pending real fuel/maintenance-cost
      // research — this figure is not final, and every vehicle in this
      // preset's fleet gets this same number for now (no per-route variance).
      dieselSavingsPerVehicleMonthlyPlaceholder: 410,
      chargingDemandPerVehicleKWPlaceholder: 11, // overnight L2 demand per bus — placeholder pending real bus battery spec research
    },
  },
  environment: {
    federalITCRate: 0.3,
    incentivePrograms: [
      {
        key: "epa_clean_school_bus",
        name: "EPA Clean School Bus Program",
        description: "Federal rebate toward electric bus purchases and charging infrastructure.",
        valueEstimate: 20_000,
        // $325k/bus is a current-best-estimate placeholder, not a stable
        // long-term constant. Research into the real EPA Clean School Bus
        // Program found it pays a per-bus dollar cap (covering both the bus
        // and its charging infrastructure), roughly $325k-$375k/bus
        // depending on funding round — NOT a flat percentage of total cost,
        // which is what this field replaced. The program also underwent a
        // major structural overhaul in February 2026: competitive scoring
        // replaced automatic rebates, and funding is now shared across
        // multiple clean-fuel types with only a 50% zero-emission minimum
        // across the whole program. It remains under political review as of
        // this writing, so treat this dollar figure as provisional in the
        // same way solarYieldFactor/interconnectionHeadroom above are.
        grantAmountPerBusCap: 325_000,
        // $3M placeholder, grounded in real EPA Clean School Bus Program
        // award data rather than sized to hit a target demo outcome: a
        // single grant round has awarded roughly $1.7M per district on
        // average (a $900M round split across ~530 districts), and
        // aggregate per-bus awards nationally have run $300k+/bus — the
        // previous $300k figure was a leftover placeholder sized for the
        // old 15%-of-cost percentage model and couldn't realistically fund
        // even one bus at the current per-bus cap. Still only an
        // approximation: real award size varies heavily by district size,
        // priority status, and competitive scoring outcomes, none of which
        // are modeled — this is one fixed lifetime pool, not a renewable
        // multi-round funding source (a later pass's design question).
        totalGrantFundingAvailable: 3_000_000,
        // Placeholder pending real program timeline research.
        applicationDecisionMonths: 3,
      },
    ],
    netMeteringPolicy: "partial",
    interconnectionQueueMonths: 14,
    // Documents this preset's existing implicit floor (the global
    // OBJECTIVE_TIER_SUCCESSFUL_MIN constant, 0.6) — not yet read by
    // evaluateFinalOutcome(), see this field's doc comment in types.ts.
    targetElectrificationRateByYear20: 0.6,
  },
  energy: {
    annualFacilityLoadKWh: 350_000, // placeholder — real utility-bill-derived load data comes later
    targetOffsetFraction: 1.0,
  },
  finance: {
    availableCapital: 250_000,
    creditRating: "BBB",
    loanTermsAvailable: [
      // Original entry, left completely unchanged — it already has both a
      // key and a label, so no field needed adding here. It was sized for
      // a smaller "muni-lease" equipment need (a 5yr term for something
      // well under $500k), not multi-hundred-thousand-dollar bus purchases.
      { key: "muni_lease", label: "Municipal Lease-Purchase", termMonths: 60, apr: 0.045, maxAmount: 500_000 },
      // 12 years is a placeholder — real municipal fleet/equipment loan
      // terms vary by lender and bond structure and this needs real research
      // to confirm before treating as final. apr matches the existing
      // entry exactly and on purpose: this pass isolates term length's own
      // effect on DSCR, not rate — no reason yet to assume a longer-term
      // program would price differently. maxAmount is a placeholder too,
      // sized larger than the short-term entry since a long-horizon fleet
      // program would realistically support bigger loans — like the existing
      // entry's maxAmount, it isn't enforced yet (see computeDebtFinancingProjection).
      { key: "fleet_equipment_long", label: "Fleet Equipment Loan (12yr)", termMonths: 144, apr: 0.045, maxAmount: 5_000_000 },
    ],
  },
  // Relocated from the old MONTHLY_OPEX_PLACEHOLDER/
  // ELECTRICITY_RATE_PLACEHOLDER_PER_KWH global constants — this preset's
  // numbers are UNCHANGED, only their location moved.
  operatingBaseline: {
    monthlyOpexPlaceholder: 8_000, // flat facility overhead until real utility-bill math replaces it
    electricityRatePerKWhPlaceholder: 0.13, // $/kWh — placeholder commercial rate, not a real utility tariff
  },
};

// Second preset, added specifically to prove FacilityProfile generalizes
// beyond a single facility type (the original design intent — never
// actually tested before this pass). Structural pass only: no mechanics
// code was changed to make this preset work, so anywhere it doesn't "just
// work" is a genuine schema gap, not an oversight in this object. See the
// audit findings in this session's report for exactly which global
// constants (vehicle cost, diesel savings, per-vehicle charging demand,
// electricity rate, monthly opex) are NOT yet preset-scoped and will still
// carry School Bus Depot-flavored numbers regardless of which preset a
// player selects.
export const TANK_WASH_PRESET: FacilityProfile = {
  name: "Prairie Grove Food-Grade Tank Wash",
  facilityType: "food_grade_tank_wash",
  location: {
    // Alliant Energy serves Iowa and Wisconsin — Iowa picked as a
    // representative service territory, not tied to a real facility address.
    state: "Iowa",
    utility: "Alliant Energy",
    climateZone: {
      key: "5A",
      label: "5A (Mixed-Humid)",
      solarYieldFactor: 1_250, // placeholder — reused from the bus depot preset's climate-zone figure, not real Iowa solar-resource data
      // Real NOAA 1991-2020 climate normals for Cedar Rapids, IA
      // (representative of this preset's Alliant Energy Iowa service
      // territory) — see ClimateZone's own doc comment in types.ts, and the
      // school-bus-depot preset's matching comment above for the derivation
      // method (same three-step hand calculation from monthly high/low
      // normals). Iowa's more continental climate shows up correctly here as
      // a slightly lower mean and a meaningfully wider seasonal swing than
      // Ohio's — not identical copy-paste data.
      // Source: NOAA-derived 1991-2020 monthly normals for Cedar Rapids, IA,
      // via usclimatedata.com's published summary of that dataset.
      meanAnnualTempF: 50.2,
      seasonalAmplitudeF: 26.3,
      dailyAmplitudeF: 10.3,
      // Real elevation, Cedar Rapids, IA (~810 ft) — closes
      // seam_reconnaissance.md §7's second residual gap alongside
      // solarIrradianceWPerM2 below.
      altitudeFt: 810,
      // Placeholder — reused from the bus depot preset's own figure, not
      // real Iowa-specific solar-resource data, same convention as
      // solarYieldFactor above already follows for this preset.
      solarIrradianceWPerM2: 250,
    },
  },
  electrical: {
    serviceVoltage: 600,
    serviceAmps: 600,
    phaseType: "three_phase", // real spec: 3-phase 4-wire, single CT metering (ALICT6-4) — the 4-wire/CT-metering detail has no dedicated field in this schema, noted here for provenance rather than modeled
    // Placeholder pending a real utility interconnection study, same
    // "fast-track screening" heuristic as the bus depot preset — not
    // confirmed data for this facility or Alliant Energy specifically.
    interconnectionHeadroom: 0.15,
  },
  site: {
    roofSqFt: 12_000, // placeholder — smaller footprint than the bus depot, not a real facility survey
    // 5 liquid sweetener bays (heated water — higher power draw) + 1
    // pneumatic bay (compressor-driven — lower draw). powerDrawKWPlaceholder
    // figures are placeholders pending real facility electrical data;
    // hasCharger is false for all of them since these are wash bays, not
    // vehicle-charging bays (a conceptually different use of "bay" than the
    // bus depot preset's charging-bay bays — bays aren't read by any
    // mechanics this pass regardless, so this doesn't affect behavior).
    bays: [
      { id: "bay_sweetener_1", label: "Liquid Sweetener Bay 1", hasCharger: false, powerDrawKWPlaceholder: 45 },
      { id: "bay_sweetener_2", label: "Liquid Sweetener Bay 2", hasCharger: false, powerDrawKWPlaceholder: 45 },
      { id: "bay_sweetener_3", label: "Liquid Sweetener Bay 3", hasCharger: false, powerDrawKWPlaceholder: 45 },
      { id: "bay_sweetener_4", label: "Liquid Sweetener Bay 4", hasCharger: false, powerDrawKWPlaceholder: 45 },
      { id: "bay_sweetener_5", label: "Liquid Sweetener Bay 5", hasCharger: false, powerDrawKWPlaceholder: 45 },
      { id: "bay_pneumatic_1", label: "Pneumatic Bay", hasCharger: false, powerDrawKWPlaceholder: 15 },
    ],
  },
  fleet: {
    totalVehicles: 18,
    vehicleClasses: [
      {
        class: "tank_wash_truck",
        count: 18,
        // Placeholder blend of the short in-town routes and the longer
        // regional routes below — not a real telematics/mileage study.
        avgAnnualMileage: 120_000,
        currentFuelType: "diesel",
        replacementCycleYears: 8, // placeholder — commercial trucks typically cycle faster than school buses; not real fleet-management data
      },
    ],
    // Placeholder route split, not a real routing study. 2 short in-town
    // routes (modeled loosely after well-known short-haul food-grade
    // customer patterns, e.g. a "General Mills style" or "Quaker style"
    // in-town run) are EV-viable; the remaining longer regional routes are
    // marked evViable: false, reflecting that long-haul regional tank runs
    // are meaningfully harder to electrify with today's charging
    // infrastructure and range — this is what makes this preset's route
    // economics harder than the bus depot's, per the lower
    // targetElectrificationRateByYear20 below.
    routes: [
      { id: "route_intown_generalmills", label: "In-Town Short Haul — General Mills Style", dailyMiles: 40, dedicatedVehicleCount: 3, evViable: true, converted: false, conversionCompletionOrdinal: null },
      { id: "route_intown_quaker", label: "In-Town Short Haul — Quaker Style", dailyMiles: 55, dedicatedVehicleCount: 3, evViable: true, converted: false, conversionCompletionOrdinal: null },
      { id: "route_regional_midwest", label: "Regional Haul — Midwest Corridor", dailyMiles: 280, dedicatedVehicleCount: 7, evViable: false, converted: false, conversionCompletionOrdinal: null },
      { id: "route_regional_east", label: "Regional Haul — Eastern Corridor", dailyMiles: 340, dedicatedVehicleCount: 5, evViable: false, converted: false, conversionCompletionOrdinal: null },
    ],
    // Distinct, research-grounded truck figures — fixes audit finding #1:
    // before this pass, these numbers were global constants shared with
    // the bus depot, so Tank Wash's trucks priced identically to school
    // buses. All still placeholders, just no longer the WRONG placeholders.
    vehicleEconomics: {
      // 2026 Class 8 electric trucks run roughly $280k-500k; CARB reported a
      // $435k average in 2024. $350k reflects a mid-range placeholder,
      // deliberately distinct from and lower than the bus figure ($375k)
      // since these are day-cab tractors, not the premium end of the range.
      costPerVehiclePlaceholder: 350_000,
      // Derived from real fuel/maintenance differentials, not
      // reverse-engineered from a target: diesel-vs-electric fuel cost
      // differential ≈ $0.30/mi + maintenance differential ≈ $0.07/mi ≈
      // $0.37/mi combined savings, × ~2,000 mi/month for these short
      // in-town routes (route_intown_generalmills/quaker average ~47.5
      // mi/day × ~30 days ≈ 1,425 mi/month per truck — 2,000 mi/month is a
      // rounder, slightly conservative-high placeholder standing in for
      // that) ≈ $740/month per converted truck. Every input is a
      // placeholder pending real fuel/maintenance-cost research for this
      // vehicle class specifically.
      dieselSavingsPerVehicleMonthlyPlaceholder: 740,
      // Placeholder, higher than the bus figure (11kW) reflecting larger
      // truck battery packs — pending real spec research.
      chargingDemandPerVehicleKWPlaceholder: 15,
    },
  },
  environment: {
    federalITCRate: 0.3, // same real federal ITC rate as the bus depot preset — the incentive STRUCTURE doesn't change by facility type, so this is reused rather than reinvented
    // Reused verbatim from the bus depot preset, per explicit direction:
    // the OBBBA/EPA-grant research already wired in doesn't change by
    // facility type. FLAGGED finding, not silently fixed: this specific
    // program is named/scoped "EPA Clean School Bus Program" — a real
    // program specifically for school buses. Reusing it verbatim for a
    // private food-grade tank-wash trucking company is a factual mismatch
    // (a real such company would need a different program, e.g. a broader
    // Clean Heavy-Duty Vehicles or state-level commercial-fleet incentive);
    // kept as directed for this pass rather than researching a replacement.
    incentivePrograms: [
      {
        key: "epa_clean_school_bus",
        name: "EPA Clean School Bus Program",
        description: "Federal rebate toward electric bus purchases and charging infrastructure.",
        valueEstimate: 20_000,
        grantAmountPerBusCap: 325_000,
        totalGrantFundingAvailable: 3_000_000,
        applicationDecisionMonths: 3,
      },
    ],
    netMeteringPolicy: "partial", // placeholder — not confirmed Alliant Energy policy
    interconnectionQueueMonths: 14, // placeholder — reused from the bus depot preset, not real Alliant Energy queue data
    // Lower than the bus depot's 0.6: this preset's fleet has a much smaller
    // EV-viable share (2 of 4 routes, 6 of 18 trucks) since long-haul
    // regional routes are harder to electrify than a bus depot's
    // return-to-base routes — reflects harder route economics, not a lower
    // ambition. Same NOT-YET-WIRED caveat as the bus depot preset's value —
    // see this field's doc comment in types.ts.
    targetElectrificationRateByYear20: 0.5,
  },
  energy: {
    // Placeholder — heated-water liquid-sweetener washing is energy-intensive
    // despite the smaller vehicle count, not a real utility-bill figure.
    annualFacilityLoadKWh: 500_000,
    targetOffsetFraction: 1.0,
  },
  finance: {
    // Placeholder — a private trucking company's starting capital and credit
    // profile plausibly differ a lot from a school district's; this figure
    // and the loan terms below are NOT researched, and may need very
    // different treatment than the municipal preset once real data exists.
    availableCapital: 400_000,
    creditRating: "BB", // placeholder — a mid-size private company, weaker than the municipal preset's BBB; not a real rating
    loanTermsAvailable: [
      // Higher APR than the municipal preset's 0.045, reflecting a private
      // company's commercial-credit risk instead of municipal bond-backed
      // financing — placeholder pending real commercial-lending research.
      { key: "commercial_equipment_5yr", label: "Commercial Equipment Loan (5yr)", termMonths: 60, apr: 0.065, maxAmount: 750_000 },
      { key: "commercial_equipment_10yr", label: "Commercial Equipment Loan (10yr)", termMonths: 120, apr: 0.065, maxAmount: 3_000_000 },
    ],
  },
  operatingBaseline: {
    // Placeholder, higher than the bus depot's $8,000: industrial wash-bay
    // power draw (heated water for the 5 liquid-sweetener bays, compressor
    // for the pneumatic bay) plausibly runs a higher flat facility overhead
    // than a bus depot's — not a real utility-bill figure.
    monthlyOpexPlaceholder: 12_000,
    // Real, sourced Alliant Energy Iowa data (not a placeholder): 2023
    // commercial rate ~13.0¢/kWh, industrial rate ~7.92¢/kWh (per
    // priceofelectricity.com/moneylogic.net rate summaries). This facility's
    // 600A/600V service and process-heating load (heated water washing,
    // compressor) more closely resembles an industrial rate-class customer
    // than a small commercial account, so the industrial figure is used —
    // a judgment call on rate-class fit, not a placeholder on the number
    // itself. Still subject to change if a real Alliant Energy tariff
    // schedule for this specific customer class/size becomes available.
    electricityRatePerKWhPlaceholder: 0.0792,
  },
};

// --- Fleet maintenance strategy (see computeMonthlyOperatingCashFlow and
// rollEvents() in engine.ts) ---
// Closes a gap flagged repeatedly through Phase 4: equipment_failure_diesel
// and ev_drivetrain_failure were designed with a "deferred maintenance
// raises failure odds" concept in mind, but no maintenance system existed
// to wire it to until this pass. Fleet-only: charger_hardware_failure,
// inverter_failure, and panel_underperformance are facility/equipment
// maintenance, a conceptually separate decision, deliberately untouched.
//
// Real fleet maintenance research shows preventive programs cut unplanned
// breakdowns 30-40% (some sources report up to 85% for strict digital PM
// programs) at a real, quantifiable cost premium — e.g. a 25-vehicle fleet
// study showing ~$14k/year additional PM spend against $177k/year net
// savings. This isn't a hypothetical tradeoff, it's the standard
// fleet-management decision in practice.
export const MAINTENANCE_PROGRAM_COST_PER_VEHICLE = 50; // $/vehicle/month, placeholder grounded in the cost-premium research above, applied to fleet.totalVehicles (converted and not)
// 0.6 = a 40% reduction, chosen as a middle-of-the-road placeholder within
// the real 30-40% research range (not the more aggressive up-to-85%
// figure, which applies specifically to strict digital PM programs — a
// stronger assumption than this pass models).
export const FLEET_MAINTENANCE_PREVENTATIVE_FAILURE_MULTIPLIER = 0.6;

// --- Uptime (see rollEvents() in engine.ts) ---
// uptimePercent is a real, per-month computed value as of this pass — a
// month with zero vehicle-failure events (equipment_failure_diesel,
// ev_drivetrain_failure; infrastructure events like charger/inverter/panel
// failures don't count, since those affect equipment, not fleet service
// delivery directly) reads 100. Percentage-point cost per failure event,
// placeholder pending real fleet-reliability data.
export const UPTIME_IMPACT_PER_FAILURE_PLACEHOLDER = 1.5;
// Floor so a bad month (many simultaneous failures) can't read negative or
// absurdly low — a sanity bound, not real data.
export const UPTIME_FLOOR_PERCENT = 60;
// Trailing history cap so a long (e.g. 20-year) run doesn't grow this array
// unbounded; oldest entries drop off once this is exceeded.
export const UPTIME_HISTORY_MAX_ENTRIES = 36;

// Thresholds from the ORIGINAL failure-threshold design (not placeholders
// pending research, unlike most other constants on this page): trailing 3mo
// uptime < 90% -> warning, < 85% -> the original design's "lose a customer
// contract" consequence. This pass (4.10) builds the trailing-average
// calculation and the warning/poor status derived from these thresholds
// only — the harder consequence is deliberately deferred, since it assumes
// a commercial/contracted operator (a freight carrier, a parcel depot) with
// no clean analog for a municipal district running its own fleet, and this
// preset doesn't have one.
export const UPTIME_WARNING_THRESHOLD = 90;
export const UPTIME_POOR_THRESHOLD = 85;

// --- Primary objective evaluation (see evaluateFinalOutcome() in engine.ts) ---
// This preset's target planning horizon — the single point at which the
// game's win/loss tier is ever computed. From the original failure-
// thresholds planning, not a research placeholder.
export const YEARS_TO_EVALUATE = 20;
// Electrification-rate tier boundaries (0-1 fractions), from the same
// original design.
export const OBJECTIVE_TIER_SUCCESSFUL_MIN = 0.6;
export const OBJECTIVE_TIER_STRONG_MIN = 0.75;
export const OBJECTIVE_TIER_EXCEPTIONAL_MIN = 0.85;
// Secondary-condition bars checked alongside the rate at year
// YEARS_TO_EVALUATE. Deliberately softer than the gates used elsewhere in
// the sim, since "surviving to the finish line at a thinner margin" is a
// different question from "should new debt be approved right now" or
// "should this month trigger a warning":
// - DSCR_MINIMUM_FOR_SUCCESS (1.0) vs. DSCR_MINIMUM_FOR_NEW_DEBT (1.25):
//   existing debt still being serviced (DSCR >= 1.0, i.e. not in active
//   breach) counts as passing, even though that same DSCR would block a NEW
//   loan origination.
// - UPTIME_FLOOR_FOR_SUCCESS (70) vs. UPTIME_WARNING_THRESHOLD/
//   UPTIME_POOR_THRESHOLD (90/85): a hard floor for the finish line, not the
//   same tiers used for the monthly warning/poor status.
export const DSCR_MINIMUM_FOR_SUCCESS = 1.0;
export const UPTIME_FLOOR_FOR_SUCCESS = 70;

export const INTERCONNECTION_STUDY_MONTHS = 18;
export const INTERCONNECTION_STUDY_MOBILIZATION_COST = 5_000; // charged immediately at commit
export const INTERCONNECTION_STUDY_MIDPOINT_COST = 5_000; // charged at month 6
export const INTERCONNECTION_STUDY_FINAL_COST = 5_000; // charged at month 12
export const INTERCONNECTION_STUDY_TOTAL_COST =
  INTERCONNECTION_STUDY_MOBILIZATION_COST + INTERCONNECTION_STUDY_MIDPOINT_COST + INTERCONNECTION_STUDY_FINAL_COST;

// --- Solar array sizing placeholders ---
export const ROOF_USABLE_FRACTION_PLACEHOLDER = 0.7; // accounts for shading, setbacks, HVAC equipment, fire-code access paths — placeholder, not a real shading/setback study
export const SQFT_PER_KW_PLACEHOLDER = 100; // standard-efficiency panel placeholder; real panel spec sheets vary
export const SOLAR_COST_PER_KW_PLACEHOLDER = 2_200; // $/kW installed — placeholder commercial EPC pricing

// --- Solar install action ---
export const SOLAR_INSTALL_MONTHS = 6; // permitting + install lead time, fixed for this pass
export const SOLAR_DESIGN_PERMIT_FRACTION = 0.2; // drawn immediately at commit
export const SOLAR_EQUIPMENT_FRACTION = 0.8; // drawn at SOLAR_EQUIPMENT_DRAW_MONTH — the leg the ITC discount applies to
export const SOLAR_EQUIPMENT_DRAW_MONTH = 5;

// Placeholder seasonal generation shape (winter low, summer high), Jan-Dec,
// roughly averaging to 1.0 across the year — not real climate data.
export const SEASONAL_GENERATION_MULTIPLIER = [
  0.55, 0.65, 0.8, 1.0, 1.2, 1.35,
  1.4, 1.3, 1.1, 0.85, 0.6, 0.5,
];

// --- Service upgrade action ---
// 24 months is deliberately fixed — this is "time you can't buy no matter how
// much cash you throw at it" (utility study queue + construction lead time).
// Do not shorten this later without a real reason; the constraint IS the point.
export const SERVICE_UPGRADE_MONTHS = 24;
export const SERVICE_UPGRADE_STUDY_FRACTION = 0.15; // drawn at commit
export const SERVICE_UPGRADE_CONSTRUCTION_FRACTION = 0.85; // drawn at SERVICE_UPGRADE_CONSTRUCTION_DRAW_MONTH
export const SERVICE_UPGRADE_CONSTRUCTION_DRAW_MONTH = 20;
export const SERVICE_UPGRADE_TOTAL_COST_PLACEHOLDER = 150_000; // $ — placeholder pending real utility upgrade cost data
export const SERVICE_UPGRADE_HEADROOM_MULTIPLIER = 1.5; // +50% of current headroom on completion — placeholder pending real utility upgrade capacity data

// --- Charger install action ---
// Per-unit kW and cost are placeholders pending real spec/vendor research.
export const CHARGER_L2_KW_PLACEHOLDER = 19;
export const CHARGER_DCFC_KW_PLACEHOLDER = 150;
export const CHARGER_L2_COST_PLACEHOLDER = 6_000; // $ per unit installed, placeholder
export const CHARGER_DCFC_COST_PLACEHOLDER = 80_000; // $ per unit installed, placeholder — DCFC power electronics cost far more per kW than L2
export const CHARGER_L2_MONTHS = 4;
export const CHARGER_DCFC_MONTHS = 7; // DCFC needs more electrical work
export const CHARGER_DESIGN_FRACTION = 0.3; // drawn at commit
export const CHARGER_INSTALL_FRACTION = 0.7; // drawn one month before completion
export const SPARE_CONDUIT_COST_MULTIPLIER = 0.25; // +25% to this commit's cost draws when over-provisioning is selected
export const SPARE_CONDUIT_CAPACITY_MULTIPLIER = 0.5; // spare capacity banked = 50% more than what was just installed

// --- OBBBA-style ITC deadline placeholders ---
// These stand in for the real One Big Beautiful Bill Act commercial-solar
// ITC phase-out: a safe-harbor window for projects that begin construction
// soon enough to keep the 30% credit under the old 2030 placed-in-service
// runway, and a hard final placed-in-service cutoff (real-world Dec 31,
// 2027) for anything that starts after that window closes. Dates here are
// placeholder in-game {month, year} pairs, not real calendar dates — see
// engine/clock.ts's monthOrdinal() for how they're compared against the
// current sim date.
export const SAFE_HARBOR_DEADLINE = { month: 9, year: 2 }; // 12 months from game start
export const FINAL_PLACED_IN_SERVICE_DEADLINE = { month: 3, year: 4 }; // +18 months after safe harbor

// --- Route conversion action ---
// Per-vehicle cost/charging-demand figures moved onto
// FacilityProfile.fleet.vehicleEconomics (see SCHOOL_BUS_DEPOT_PRESET/
// TANK_WASH_PRESET above) — no longer global constants here.
export const ROUTE_CONVERSION_MONTHS = 10; // vehicle order backlog — placeholder pending real manufacturer lead time research
export const ROUTE_CONVERSION_DEPOSIT_FRACTION = 0.25; // drawn at commit (order deposit)
export const ROUTE_CONVERSION_DELIVERY_FRACTION = 0.75; // drawn at ROUTE_CONVERSION_DELIVERY_DRAW_MONTH (delivery)
export const ROUTE_CONVERSION_DELIVERY_DRAW_MONTH = 9;

// Debt financing for routeConversion. Only the first entry in
// FacilityProfile.finance.loanTermsAvailable is used this pass — no
// multi-offer comparison UI, and that term's maxAmount cap is deliberately
// not enforced yet (the spec for this pass names only termMonths/apr as
// what to use; a real per-offer borrowing cap is a future richer-financing
// pass, and enforcing it now would make every route's loan too large to
// originate under the current preset's single small muni-lease offer).
export const ROUTE_CONVERSION_DOWN_PAYMENT_FRACTION = 0.2; // placeholder pending real lender underwriting norms
export const DSCR_MINIMUM_FOR_NEW_DEBT = 1.25; // lenders refuse new debt below this line

// Loan refinancing (Phase 4.11). 2% of remainingPrincipal is a placeholder
// grounded in real commercial rate-and-term refinance closing costs
// (typically 1-3% of the refinanced balance) — distinct from, and cheaper
// than, a cash-out refi, which this pass does not build. Charged once,
// immediately, at the moment refinanceLoan() succeeds.
export const LOAN_REFINANCE_COST_FRACTION = 0.02;

// Diesel fuel/maintenance savings from converted routes moved onto
// FacilityProfile.fleet.vehicleEconomics.dieselSavingsPerVehicleMonthlyPlaceholder
// (see SCHOOL_BUS_DEPOT_PRESET/TANK_WASH_PRESET above for the per-preset
// derivation comments) — no longer a global constant here.

// Game-balance choice, not a real-world data point like the constants above —
// deliberately a round number rather than something flagged pending research.
// Matches the original failure-thresholds design: insolvency = cash stays
// negative for this many consecutive months.
export const INSOLVENCY_THRESHOLD_MONTHS = 3;

// --- Event table (proof of mechanism — see rollEvents() in engine.ts) ---
// Step 4 of the tick sequence design ("event roll"), unbuilt through all of
// Phase 3. Phase 4.1 proved the mechanism with the first two entries below;
// Phase 4.2 added two market events and one simplified grid event; Phase 4.3
// added two regulatory events; Phase 4.4 added two opportunity events; Phase
// 4.5 added one more market event and one equipment event; Phase 4.6 added
// one more equipment event and one more regulatory event; Phase 4.7 added
// one more equipment event and one more grid event; Phase 4.8 added one more
// equipment event; a later pass added maintenance_strategy_changed; this
// pass added short_outage/extended_outage, unblocked by real uptime
// tracking (4.9/4.10). All chosen specifically because they don't require
// battery storage, load management, or training-lag systems (none of which
// exist in the sim yet).
// Deferred maintenance raising equipment-failure odds is now built, but
// fleet-only (see SimState.maintenanceStrategy) — equipment_failure_diesel
// and ev_drivetrain_failure are the only two events it touches;
// charger_hardware_failure/inverter_failure/panel_underperformance still
// have no maintenance system, since facility/equipment maintenance is a
// conceptually separate decision from fleet maintenance.
// short_outage/extended_outage apply their full uptime/cash effect with NO
// mitigation available — no battery storage or backup generator system
// exists in this sim; either, if ever built, would reduce these events'
// impact.
// Still out of scope: curtailment (needs net metering),
// driver_turnover/customer_contract_renewal_pressure and other
// operational-category events (need training-lag and uptime systems), any
// PERMANENT generation degradation and battery degradation (no battery
// storage system exists), any capacity-loss mechanic, any windowed/
// time-limited discount mechanic, severity tiers, seasonality weighting (no
// event uses it yet, kept consistent), and further state-dependent
// probability modifiers beyond what's built.
// Every probability and magnitude below is a placeholder pending the fuller
// event-table research pass.
export const EVENT_TABLE: EventTableEntry[] = [
  {
    type: "diesel_price_shock",
    label: "Diesel Price Shock",
    baseMonthlyProbability: 0.015,
    description:
      "Diesel fuel prices move sharply, up or down — shifts dieselPriceMultiplier by a random ±15-40%, persisting until the next shock changes it again. Placeholder magnitude, not real diesel-price-volatility data.",
  },
  {
    type: "equipment_failure_diesel",
    label: "Diesel Equipment Failure",
    baseMonthlyProbability: 0.008, // per vehicle class that still has unconverted diesel vehicles
    description:
      "An aging diesel vehicle in a not-yet-converted class breaks down — a one-time unplanned repair cost. Rolls only against vehicle classes with unconverted vehicles remaining (electrified vehicles don't roll this event) — ties into the 'keeping old equipment running costs more over time' theme. Placeholder probability and cost range, not real fleet-maintenance data.",
  },
  {
    type: "electricity_rate_increase",
    label: "Electricity Rate Increase",
    baseMonthlyProbability: 0.008,
    description:
      "The utility raises retail electricity rates — permanently increases SimState.electricityRatePerKWh (used in solar-savings/opex math) by a random 5-15%, compounding on every occurrence rather than resetting. Placeholder magnitude, not a real utility rate case.",
  },
  {
    type: "interest_rate_movement",
    label: "Interest Rate Movement",
    baseMonthlyProbability: 0.02,
    description:
      "Market interest rates shift — adjusts the APR on every facility.finance.loanTermsAvailable entry by the same random ±0.25-0.75 percentage points. Only affects loans originated AFTER this fires: SimState.totalMonthlyDebtService is a running sum of payments already computed at each loan's own origination-time rate (see commitToRouteConversion's debt branch) and is never recalculated from the live rate table, so existing debt keeps its original locked-in rate. Placeholder magnitude, not real rate-movement data.",
  },
  {
    type: "demand_spike_billing",
    label: "Demand Spike Billing (simplified)",
    baseMonthlyProbability: 0.03,
    description:
      "A simplified stand-in for real utility demand-charge billing — a one-time cash cost from a peak-demand spike. Real demand-charge exposure would properly require load-management/battery-storage mitigation systems that don't exist in this sim yet; full grid event modeling (including outages and curtailment) is deferred until uptime tracking and net metering exist. Placeholder cost range, not a real demand-charge tariff.",
  },
  {
    type: "incentive_program_closes_early",
    label: "Incentive Program Closes Early",
    baseMonthlyProbability: 0.004,
    description:
      "Represents real policy/funding uncertainty layered on top of the known, fixed SAFE_HARBOR_DEADLINE date — moves that deadline up by a random 3-12 months, applied immediately: any pending solarInstall whose equipment draw hasn't fired yet loses ITC eligibility on that draw exactly as if it had committed after the (now-earlier) deadline, reusing currentItcRate() rather than a duplicate check. Can only fire once per game (SimState.incentiveProgramClosedEarlyFired). Placeholder probability and magnitude, not real policy-risk data.",
  },
  {
    type: "permitting_delay",
    label: "Permitting Delay",
    baseMonthlyProbability: 0.02, // rolled independently per eligible pending action, not once globally
    description:
      "A permitting/inspection delay adds a random 1-3 months to a specific pending action's monthsRemaining — rolled independently against every currently-pending solarInstall, serviceUpgrade, chargerInstall, or routeConversion (interconnection_study is not eligible). monthsOriginal is left unchanged so the slip is visible against the original estimate, matching the CommittedAction schema's slip-tracking design. Pure time delay, no cash cost; can stack if an action is unlucky more than once. Placeholder magnitude, not real permitting-timeline data.",
  },
  {
    type: "utility_pilot_program",
    label: "Utility Pilot Program",
    baseMonthlyProbability: 0.005,
    description:
      "The utility invites the district into a pilot program — a one-time cash inflow, placeholder $5,000-15,000 random range, not real utility pilot-payment data. Also sets SimState.isPilotProgramParticipant, stored but with no further consequence wired up this pass — reserved for a future data-sharing/obligation mechanic (e.g. required usage reporting, a reciprocal commitment) that real pilot participation would carry; deliberately deferred.",
  },
  {
    type: "grant_bulk_purchase_opportunity",
    label: "Grant Bulk Purchase Opportunity",
    baseMonthlyProbability: 0.006,
    description:
      "A one-time addition to the EPA grant program's totalGrantFundingAvailable pool, placeholder $500,000-1,000,000 random range, not real program-allocation data. Adds directly to the pool without touching any existing reservation, and doesn't require a pending action to exist when it fires. No windowed/time-limited discount mechanic modeled — just a pool top-up.",
  },
  {
    type: "ev_price_decline",
    label: "EV Price Decline",
    baseMonthlyProbability: 0.01,
    description:
      "Permanently reduces SimState.evCostPerVehicle by a random 3-8%, compounding on every occurrence (same pattern as electricity_rate_increase) — this one is grounded in a real, ongoing trend rather than a speculative placeholder: EV battery pack prices have fallen from roughly $153/kWh in 2022 toward an estimated ~$80/kWh by 2026. The 3-8%/occurrence figure is still a placeholder pending a proper cost-curve model. Only affects routeConversion commits made AFTER it fires — evCostPerVehicle is read fresh at commit time, so an already-pending or already-completed conversion's baked-in cost draws are never retroactively changed, same principle that already protects existing debt from interest_rate_movement.",
  },
  {
    type: "charger_hardware_failure",
    label: "Charger Hardware Failure",
    baseMonthlyProbability: 0.01, // per independent 20kW band of installedChargerKW -- see rollEvents() for the banding
    description:
      "A one-time repair cash cost, placeholder $2,000-6,000 random range, not real charger-maintenance data. Rolled independently once per full 20kW band of installedChargerKW (floor(installedChargerKW / 20) independent rolls each tick) — a simplification standing in for 'more installed hardware, proportionally more chances something breaks,' not a real per-unit failure-rate model. Does NOT reduce installedChargerKW or reservedChargerCapacityKW: this is a repair-cost-only event this pass. Modeling temporary capacity loss during the repair (which a real hardware failure would cause) is deliberately deferred.",
  },
  {
    type: "inverter_failure",
    label: "Inverter Failure",
    baseMonthlyProbability: 0.003, // for the first 120 months since the most recent solarInstall completed; x5 after that -- see rollEvents()
    description:
      "Only rolls once a solarInstall has completed (no solar, no inverter, no roll). Grounded in real inverter lifespan research: a typical replacement window of 10-15 years — this event models that as a x5 probability multiplier once the system passes 120 months (10 years) since completion, on top of the 0.003 base rate for the years before that. Effect is a one-time cash cost equal to a random 5-9% of that system's original (pre-ITC) total cost, also grounded in the same research (inverter replacement typically running a mid-single-digit-to-~10% fraction of total system cost). Only tracks the most recent completed solarInstall (see SimState.solarCompletionOrdinal/solarSystemOriginalCost) — a simplification, not a per-installation history.",
  },
  {
    type: "grant_program_funding_cut",
    label: "Grant Program Funding Cut",
    baseMonthlyProbability: 0.003,
    description:
      "Represents real political/budget uncertainty specific to the federal school-bus grant program — distinct from incentive_program_closes_early, which targets the separate ITC/solar safe-harbor deadline. Cuts a random 30-60% of the grant pool's CURRENT unreserved remaining balance (totalGrantFundingAvailable), not the original total — amounts already reserved against pending/completed grant-financed routeConversion commits are untouched, since totalGrantFundingAvailable already excludes those (reserved at commit time — see commitToRouteConversion's grant branch). Can only fire once per game (SimState.grantProgramFundingCutFired), same one-shot pattern as incentive_program_closes_early. Placeholder probability and magnitude, not real policy-risk data.",
  },
  {
    type: "panel_underperformance",
    label: "Panel Underperformance",
    baseMonthlyProbability: 0.02,
    description:
      "Only rolls once a solarInstall has completed (solarCapacityKW > 0). Grounded in NREL soiling-loss research showing ~5% typical annual generation loss from dust/debris/snow, with acute episodes (heavy pollen, wildfire smoke, snow cover) running higher — modeled here as a temporary 0.85-0.95 generation multiplier (placeholder range) lasting a random 1-3 months (placeholder duration) before fully reverting to normal generation. No cash cost — this reduces solar savings only, via SimState.panelUnderperformanceMonthsRemaining/panelUnderperformanceMultiplier, which computeMonthlyOperatingCashFlow reads each tick. A cleaning/maintenance system to reduce this event's odds is deliberately deferred — no maintenance system exists yet for any equipment type. Does not stack: a new roll while an episode is already active is ignored rather than restarting/extending it.",
  },
  {
    type: "power_quality_issue",
    label: "Power Quality Issue",
    baseMonthlyProbability: 0.01, // only rolls at all once reservedInterconnectionKW / interconnectionHeadroomKW exceeds 0.85 -- see rollEvents()
    description:
      "Only rolls when the facility is running close to its electrical service limit — specifically when reservedInterconnectionKW / interconnectionHeadroomKW exceeds 0.85 (0.01/month above that threshold, 0 below it). Grounded in the real-world principle that voltage sag, harmonics, and other power-quality problems become more likely as load approaches a service's rated capacity. Effect is a one-time diagnostic/repair cash cost, placeholder $1,000-3,000 random range, not real utility power-quality-incident data.",
  },
  {
    type: "ev_drivetrain_failure",
    label: "EV Drivetrain Failure",
    baseMonthlyProbability: 0.001, // per vehicle in a converted route, within 96 months of that route's conversion; jumps to 0.006/vehicle after month 96 -- see rollEvents()
    description:
      "Only rolls per route where converted === true, independently per vehicle in that route (Route.dedicatedVehicleCount rolls/tick for a fully-converted route). Grounded in real 8yr/100k-mile EV drivetrain warranty coverage: 0.001/vehicle/month for the first 96 months (8 years) since that route's conversion completed (near-zero out-of-pocket cost during the warranty window), jumping to a x6 multiplier (~0.006/vehicle/month at the default rate) after month 96 (post-warranty exposure) — same 'multiplier off baseMonthlyProbability' pattern as inverter_failure's late-life jump. Effect is a one-time repair cash cost: $1,500-4,000 during warranty (a deductible or minor uncovered item, not a full drivetrain replacement), $4,000-10,000 after warranty — grounded in real ESB maintenance-savings research showing $4,000-11,000/year total savings vs. diesel, implying a single post-warranty failure can meaningfully eat into or exceed a year's savings. Tracks months-since-conversion per route via Route.conversionCompletionOrdinal, same pattern as SimState.solarCompletionOrdinal (4.6).",
  },
  {
    type: "short_outage",
    label: "Short Outage",
    baseMonthlyProbability: 0.02,
    description:
      "A grid outage directly reduces that month's uptimePercent by a random 2-4 points (placeholder range), applied ON TOP OF the existing failure-count-based calculation from the uptime pass, before the uptime floor. No cash cost. No mitigation available — no battery storage or backup generator system exists in this sim; either, if ever built, would reduce this event's impact. Rolls independently of extended_outage; both can fire the same month, and their reductions stack additively.",
  },
  {
    type: "extended_outage",
    label: "Extended Outage",
    baseMonthlyProbability: 0.003,
    description:
      "A longer grid outage directly reduces that month's uptimePercent by a random 8-15 points (placeholder range), same additive/floored treatment as short_outage. Also applies a one-time cash cost, placeholder $500-1,500, representing lost productivity/cleanup — distinct from a repair cost, since nothing physically breaks in an outage. No mitigation available, same reasoning as short_outage. Rolls independently of short_outage; both can fire the same month, and their reductions stack additively.",
  },
];
