/** Generated from ev-thermal-sim's examples/generate_seam_table.py --
 * do not hand-edit. Re-run that script and re-paste this array if the
 * upstream model/coefficients/profile data changes.
 *
 * Shape: docs (ev-thermal-sim's docs/seam_reconnaissance.md §5). See
 * SeamTableRow's own doc comment below for what each field means and the
 * v1 scope limits (one row, point-estimate methodology, no per-route
 * vehicle-class/climate disambiguation beyond a simple vehicle_class match
 * -- see manufacturerProfileKey's own doc comment in types.ts).
 */

export interface SeamTableRow {
  vehicleClass: string;
  climateZone: string;
  dutyCycleArchetype: string;
  methodology: "point_estimate" | "monte_carlo";
  /** Incremental (not cumulative) SOH percentage points lost in each calendar month since conversion -- index 0 is month 1. */
  monthlySohDeltaPct: number[];
  sourceSeed: number;
  sourceDurationYears: number;
  /** Known limitations that travel with this row's specific numbers -- see each string for what it means before using this data for anything player-facing beyond simple tracking. */
  caveats: string[];
  generatedAt: string;
}

export const SEAM_TABLE_ROWS: SeamTableRow[] = [
  {
    vehicleClass: "blue_bird_vision_electric",
    climateZone: "columbus_oh",
    dutyCycleArchetype: "default",
    methodology: "point_estimate",
    monthlySohDeltaPct: [0.20508, 0.304131, 0.182143, 0.309765, 0.251428, 0.204158, 0.299267, 0.337638, 0.353591, 0.357249, 0.362615, 0.339593, 0.320898, 0.254215, 0.301145, 0.300054, 0.29032, 0.294719, 0.334571, 0.334763, 0.364016, 0.346116, 0.359683, 0.314405, 0.290265, 0.318608, 0.262144, 0.283204, 0.287068, 0.247818, 0.342185, 0.358391, 0.355977, 0.356857, 0.365224, 0.301845, 0.323183, 0.319584, 0.295206, 0.277858, 0.273219, 0.262396, 0.306394, 0.319459, 0.356757, 0.338543, 0.354313, 0.345719, 0.283821, 0.266727, 0.257338, 0.196298, 0.294313, 0.323848, 0.349539, 0.325974, 0.368486, 0.357309, 0.366245, 0.332223, 0.273685, 0.330194, 0.195672, 0.249364, 0.283713, 0.249596, 0.318627, 0.318975, 0.376393, 0.363814, 0.329313, 0.312854, 0.281898, 0.307906, 0.256793, 0.224951, 0.25168, 0.279786, 0.341944, 0.336129, 0.359604, 0.363976, 0.369854, 0.339539, 0.31707, 0.314883, 0.211009, 0.302023, 0.309829, 0.28905, 0.307417, 0.354122, 0.36437, 0.361076, 0.357252, 0.29953, 0.32337, 0.303427, 0.289065, 0.314228, 0.304516, 0.284816, 0.318093, 0.277113, 0.344741, 0.365368, 0.353426, 0.278851, 0.243906, 0.280921, 0.278283, 0.334761, 0.298198, 0.261758, 0.23651, 0.33465, 0.297673, 0.357819, 0.35585, 0.352509, 0.300137, 0.265652, 0.296147, 0.300235, 0.260877, 0.283982, 0.297655, 0.326751, 0.355734, 0.356757, 0.36267, 0.329209, 0.317526, 0.303964, 0.21942, 0.277558, 0.207041, 0.323256, 0.268085, 0.314853, 0.370414, 0.358199, 0.369445, 0.325054, 0.298012, 0.321702, 0.23331, 0.23583, 0.300342, 0.295168, 0.299535, 0.264825, 0.372395, 0.356281, 0.354311, 0.341199, 0.344, 0.282997, 0.216463, 0.271011, 0.29665, 0.314697, 0.292815, 0.316219, 0.372952, 0.353364, 0.352881, 0.305927, 0.31913, 0.198205, 0.280158, 0.285103, 0.31163, 0.312552, 0.331323, 0.299657, 0.36264, 0.356232, 0.331056, 0.340557, 0.287344, 0.308209, 0.256517, 0.265109, 0.305302, 0.293818, 0.286216, 0.353511, 0.364218, 0.358776, 0.330917, 0.345089, 0.306554, 0.308693, 0.215198, 0.292047, 0.280442, 0.296679, 0.346233, 0.299968, 0.367076, 0.364278, 0.36058, 0.305825, 0.330404, 0.315921, 0.239185, 0.28317, 0.245401, 0.250571, 0.269453, 0.32792, 0.358648, 0.35904, 0.370171, 0.28844, 0.306777, 0.314693, 0.300555, 0.254647, 0.241291, 0.230334, 0.318464, 0.356406, 0.35368, 0.362997, 0.364765, 0.340004, 0.296757, 0.277292, 0.302715, 0.28273, 0.26867, 0.250694, 0.191899, 0.275696, 0.368738, 0.362955, 0.362658, 0.325495],
    sourceSeed: 42,
    sourceDurationYears: 20,
    caveats: [
    "methodology=point_estimate is NOT a median -- see mc.py's own 'p50 vs. the point estimate' note; an unperturbed point estimate and an MC median diverge, more so at longer horizons.",
    "typical_end_soc=1.0 (this profile's real depot-charging convention, Q-0022) sits outside aging.py's calendar-aging calibration range (the two fleet anchors were derived under constant 80%/60% SOC, never 100%).",
    "Calendar aging's linear-in-time formulation (no saturation term) is a known extrapolation limit for a 20-year horizon, 2-4x past the calibration anchors' own 5-10 year window (Q-0017).",
    "This profile's seven aging-rate coefficients, shared with the six passenger-EV profiles, have never been validated against any commercial/heavy-duty vehicle's chemistry or duty cycle.",
    "cooling.py's chiller path is real and validated (Q-0021) but Columbus's climate doesn't get hot enough to meaningfully engage it -- these numbers carry the same radiator-dominated thermal behavior as a non-chiller-equipped profile would show under this specific climate.",
    ],
    generatedAt: "2026-09-26",
  },
];
