/**
 * Grid carbon intensity by zone.
 *
 * GENERATED FILE. See ./INGEST.md. Do not edit by hand.
 *
 * Average (location-based): Ember via Our World in Data, "Carbon intensity of
 * electricity generation" (CC BY). Latest year available per country.
 *   https://ourworldindata.org/grapher/carbon-intensity-electricity
 *
 * Marginal: DERIVED, not measured. See MARGINAL_METHOD below before using one.
 */

export interface GridZoneRow {
  readonly zone: string;
  readonly label: string;
  /** Year of the underlying observation. */
  readonly year: number;
  readonly avg: number;
  readonly avgLow: number;
  readonly avgHigh: number;
  /** Fossil-weighted marginal estimate, or null where it cannot be inferred. */
  readonly marginal: number | null;
  readonly marginalLow: number | null;
  readonly marginalHigh: number | null;
  /** Fossil share of generation, the basis of the marginal inference. */
  readonly fossilShare: number | null;
  /**
   * Land-use intensity, cm² per kWh, derived from the generation mix.
   * Band spans direct footprint (low) to footprint-plus-spacing / reservoir (high) —
   * for wind that is a 92x range, which is why we report a band and not a figure.
   */
  readonly landCm2PerKwh: number | null;
  readonly landLow: number | null;
  readonly landHigh: number | null;
}

export const GRID_SOURCE = "Ember via Our World in Data (CC BY)";
export const GRID_SOURCE_URL = "https://ourworldindata.org/grapher/carbon-intensity-electricity";
export const GRID_RETRIEVED = "2026-07-31";

/**
 * How the marginal figures are produced, and why they are estimates.
 *
 * A true marginal operating emissions rate (MOER) is measured by regressing grid
 * emissions against load. We do not have that data — it is what WattTime sells —
 * so these are inferred from the fossil generation mix on the reasoning that the
 * units following load are the dispatchable fossil ones.
 *
 *   marginal = Σ (share of source within fossil generation × source intensity)
 *
 * with coal 950 [820–1100], gas 490 [370–610], oil 700 [600–850] gCO₂e/kWh. Gas
 * skews above baseload CCGT because peaking plant is often less efficient OCGT,
 * and peakers are disproportionately on the margin.
 *
 * Two guards keep this honest:
 *
 *   • Below 5% fossil generation the marginal unit is more likely hydro, imports
 *     or curtailed renewables. We return null rather than guess. Norway and
 *     Sweden sit here — inferring a marginal ~20× their average off a 1% fossil
 *     sliver would look authoritative and mean nothing.
 *   • Between 5% and 20% the inference is weak, so the band widens by a further
 *     ±35%.
 *
 * Every figure here is flagged `estimated`. `resolveGrid` will not hand one to a
 * reduction claim unless the caller explicitly opts in.
 */
export const MARGINAL_METHOD = "fossil-mix-weighted";
export const MARGINAL_MIN_FOSSIL_SHARE = 0.05;

/**
 * Zones whose most recent observation predates this year are dropped rather than
 * served. Grids decarbonise fast enough that a 15-year-old intensity is not a
 * stale number, it is a wrong one — and a country with no electricity data since
 * 2009 is not hosting anyone's inference. They fall back to the global average.
 */
export const MIN_OBSERVATION_YEAR = 2020;

/**
 * Land-use intensity by generation source, ha/TWh/yr converted to cm²/kWh.
 *
 * Sources: Land-use intensity of electricity production (PLOS One, 2022,
 * doi 10.1371/journal.pone.0270155); Breakthrough Institute land-use survey;
 * Our World in Data, land use per energy source.
 *
 * The low bound is direct physical footprint; the high bound includes spacing
 * (wind farms, solar arrays) and reservoir area (hydro). For wind those differ by
 * roughly 92x — 130 vs 12,000 ha/TWh — which is the same on-site/off-site boundary
 * problem as water, handled the same way: report the band, do not pick the
 * flattering end.
 *
 * The uncomfortable consequence, which we publish rather than bury: renewable-heavy
 * grids often score WORSE on land than coal-heavy ones. Great Britain sits near
 * 960 cm²/kWh against South Africa's 172, while emitting a third of the carbon.
 * A metric that only ever flattered the clean option would not be a measurement.
 */
export const LAND_SOURCE = "PLOS One 2022 land-use intensity + Breakthrough Institute + Our World in Data";

export const GRID_ZONES: readonly GridZoneRow[] = [
  { zone: "ABW", label: "Aruba", year: 2024, avg: 550, avgLow: 467.5, avgHigh: 632.5, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.83, landCm2PerKwh: 148.8, landLow: 74.22, landHigh: 385.1 },
  { zone: "AFG", label: "Afghanistan", year: 2024, avg: 131.3, avgLow: 111.6, avgHigh: 151, marginal: 758, marginalLow: 423, marginalHigh: 1225, fossilShare: 0.131, landCm2PerKwh: 497.88, landLow: 184.85, landHigh: 1206.26 },
  { zone: "AGO", label: "Angola", year: 2024, avg: 185.4, avgLow: 157.6, avgHigh: 213.2, marginal: 628, marginalLow: 521, marginalHigh: 768, fossilShare: 0.263, landCm2PerKwh: 475.79, landLow: 170.71, landHigh: 1156.63 },
  { zone: "ALB", label: "Albania", year: 2024, avg: 25.2, avgLow: 21.4, avgHigh: 29, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: 585.32, landLow: 200.0, landHigh: 1451.89 },
  { zone: "AE", label: "United Arab Emirates", year: 2024, avg: 467.5, avgLow: 397.4, avgHigh: 537.6, marginal: 490, marginalLow: 370, marginalHigh: 610, fossilShare: 1.0, landCm2PerKwh: 70.0, landLow: 41.0, landHigh: 190.0 },
  { zone: "AR", label: "Argentina", year: 2025, avg: 346, avgLow: 294.1, avgHigh: 397.9, marginal: 518, marginalLow: 399, marginalHigh: 641, fossilShare: 0.584, landCm2PerKwh: 303.46, landLow: 107.68, landHigh: 702.56 },
  { zone: "ARM", label: "Armenia", year: 2025, avg: 211.9, avgLow: 180.1, avgHigh: 243.7, marginal: 490, marginalLow: 370, marginalHigh: 610, fossilShare: 0.341, landCm2PerKwh: 218.48, landLow: 92.14, landHigh: 520.35 },
  { zone: "ASM", label: "American Samoa", year: 2024, avg: 611.1, avgLow: 519.4, avgHigh: 702.8, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.944, landCm2PerKwh: 126.67, landLow: 86.67, landHigh: 253.89 },
  { zone: "ATG", label: "Antigua and Barbuda", year: 2024, avg: 594.6, avgLow: 505.4, avgHigh: 683.8, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.919, landCm2PerKwh: 129.73, landLow: 89.73, landHigh: 255.68 },
  { zone: "AU", label: "Australia", year: 2025, avg: 525.2, avgLow: 446.4, avgHigh: 604, marginal: 818, marginalLow: 691, marginalHigh: 960, fossilShare: 0.649, landCm2PerKwh: 249.37, landLow: 121.71, landHigh: 534.99 },
  { zone: "AT", label: "Austria", year: 2025, avg: 116.9, avgLow: 99.4, avgHigh: 134.4, marginal: 547, marginalLow: 281, marginalHigh: 912, fossilShare: 0.164, landCm2PerKwh: 761.51, landLow: 269.0, landHigh: 1564.93 },
  { zone: "AZE", label: "Azerbaijan", year: 2025, avg: 631.9, avgLow: 537.1, avgHigh: 726.7, marginal: 491, marginalLow: 371, marginalHigh: 611, fossilShare: 0.879, landCm2PerKwh: 152.01, landLow: 66.21, landHigh: 374.92 },
  { zone: "BDI", label: "Burundi", year: 2024, avg: 183.7, avgLow: 156.1, avgHigh: 211.2, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.245, landCm2PerKwh: 588.57, landLow: 207.35, landHigh: 1346.94 },
  { zone: "BE", label: "Belgium", year: 2025, avg: 149.8, avgLow: 127.3, avgHigh: 172.3, marginal: 538, marginalLow: 423, marginalHigh: 665, fossilShare: 0.28, landCm2PerKwh: 417.7, landLow: 150.0, landHigh: 804.17 },
  { zone: "BEN", label: "Benin", year: 2024, avg: 584.2, avgLow: 496.5, avgHigh: 671.8, marginal: 542, marginalLow: 427, marginalHigh: 669, fossilShare: 0.96, landCm2PerKwh: 88.61, landLow: 56.56, landHigh: 209.41 },
  { zone: "BFA", label: "Burkina Faso", year: 2024, avg: 562.1, avgLow: 477.8, avgHigh: 646.4, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.828, landCm2PerKwh: 455.86, landLow: 196.45, landHigh: 787.1 },
  { zone: "BGD", label: "Bangladesh", year: 2025, avg: 696.1, avgLow: 591.7, avgHigh: 800.5, marginal: 617, marginalLow: 497, marginalHigh: 747, fossilShare: 0.979, landCm2PerKwh: 99.13, landLow: 61.79, landHigh: 231.09 },
  { zone: "BG", label: "Bulgaria", year: 2025, avg: 275.6, avgLow: 234.2, avgHigh: 316.9, marginal: 864, marginalLow: 737, marginalHigh: 1009, fossilShare: 0.281, landCm2PerKwh: 393.75, landLow: 165.53, landHigh: 684.73 },
  { zone: "BHR", label: "Bahrain", year: 2024, avg: 902.2, avgLow: 766.9, avgHigh: 1037.6, marginal: 490, marginalLow: 370, marginalHigh: 610, fossilShare: 0.997, landCm2PerKwh: 70.45, landLow: 41.42, landHigh: 190.34 },
  { zone: "BHS", label: "Bahamas", year: 2024, avg: 653.3, avgLow: 555.3, avgHigh: 751.3, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.991, landCm2PerKwh: 121.07, landLow: 81.07, landHigh: 250.62 },
  { zone: "BIH", label: "Bosnia and Herzegovina", year: 2025, avg: 570.6, avgLow: 485, avgHigh: 656.2, marginal: 945, marginalLow: 816, marginalHigh: 1095, fossilShare: 0.564, landCm2PerKwh: 337.71, landLow: 143.55, landHigh: 787.07 },
  { zone: "BLR", label: "Belarus", year: 2025, avg: 309.2, avgLow: 262.9, avgHigh: 355.6, marginal: 505, marginalLow: 386, marginalHigh: 627, fossilShare: 0.586, landCm2PerKwh: 118.08, landLow: 51.45, landHigh: 249.01 },
  { zone: "BLZ", label: "Belize", year: 2024, avg: 170.2, avgLow: 144.7, avgHigh: 195.7, marginal: 700, marginalLow: 390, marginalHigh: 1148, fossilShare: 0.128, landCm2PerKwh: 2301.28, landLow: 797.45, landHigh: 3868.51 },
  { zone: "BMU", label: "Bermuda", year: 2024, avg: 639.3, avgLow: 543.4, avgHigh: 735.2, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.984, landCm2PerKwh: 213.11, landLow: 111.48, landHigh: 393.44 },
  { zone: "BOL", label: "Bolivia", year: 2025, avg: 481.3, avgLow: 409.1, avgHigh: 553.5, marginal: 495, marginalLow: 375, marginalHigh: 616, fossilShare: 0.639, landCm2PerKwh: 413.18, landLow: 153.23, landHigh: 865.07 },
  { zone: "BR", label: "Brazil", year: 2025, avg: 110, avgLow: 93.5, avgHigh: 126.4, marginal: 615, marginalLow: 322, marginalHigh: 1006, fossilShare: 0.113, landCm2PerKwh: 822.59, landLow: 282.75, landHigh: 1688.5 },
  { zone: "BRB", label: "Barbados", year: 2024, avg: 594.6, avgLow: 505.4, avgHigh: 683.8, marginal: 694, marginalLow: 593, marginalHigh: 843, fossilShare: 0.91, landCm2PerKwh: 129.46, landLow: 89.76, landHigh: 254.68 },
  { zone: "BRN", label: "Brunei", year: 2024, avg: 892.1, avgLow: 758.3, avgHigh: 1025.9, marginal: 583, marginalLow: 461, marginalHigh: 709, fossilShare: 0.998, landCm2PerKwh: 86.58, landLow: 53.31, landHigh: 212.54 },
  { zone: "BTN", label: "Bhutan", year: 2024, avg: 23.6, avgLow: 20.1, avgHigh: 27.2, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: 600.0, landLow: 200.0, landHigh: 1500.0 },
  { zone: "BWA", label: "Botswana", year: 2024, avg: 851.3, avgLow: 723.6, avgHigh: 979, marginal: 946, marginalLow: 817, marginalHigh: 1096, fossilShare: 0.997, landCm2PerKwh: 149.83, landLow: 100.0, landHigh: 299.33 },
  { zone: "CA", label: "Canada", year: 2025, avg: 190.7, avgLow: 162.1, avgHigh: 219.3, marginal: 582, marginalLow: 462, marginalHigh: 709, fossilShare: 0.23, landCm2PerKwh: 458.09, landLow: 154.47, landHigh: 1086.64 },
  { zone: "CH", label: "Switzerland", year: 2025, avg: 39.2, avgLow: 33.3, avgHigh: 45.1, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: 439.6, landLow: 162.82, landHigh: 978.18 },
  { zone: "CL", label: "Chile", year: 2025, avg: 289.5, avgLow: 246.1, avgHigh: 332.9, marginal: 737, marginalLow: 612, marginalHigh: 873, fossilShare: 0.336, landCm2PerKwh: 600.6, landLow: 234.47, landHigh: 1166.53 },
  { zone: "CN", label: "China", year: 2025, avg: 525.3, avgLow: 446.5, avgHigh: 604.1, marginal: 921, marginalLow: 792, marginalHigh: 1070, fossilShare: 0.583, landCm2PerKwh: 339.57, landLow: 146.6, landHigh: 714.68 },
  { zone: "CIV", label: "Cote d'Ivoire", year: 2024, avg: 405, avgLow: 344.3, avgHigh: 465.8, marginal: 491, marginalLow: 371, marginalHigh: 611, fossilShare: 0.711, landCm2PerKwh: 270.87, landLow: 103.73, landHigh: 636.23 },
  { zone: "CMR", label: "Cameroon", year: 2024, avg: 225.9, avgLow: 192, avgHigh: 259.8, marginal: 528, marginalLow: 411, marginalHigh: 653, fossilShare: 0.269, landCm2PerKwh: 486.72, landLow: 169.09, landHigh: 1185.85 },
  { zone: "COD", label: "Democratic Republic of Congo", year: 2024, avg: 27.6, avgLow: 23.5, avgHigh: 31.8, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: 546.51, landLow: 201.13, landHigh: 1318.67 },
  { zone: "COG", label: "Congo", year: 2024, avg: 716.1, avgLow: 608.7, avgHigh: 823.5, marginal: 504, marginalLow: 385, marginalHigh: 626, fossilShare: 0.791, landCm2PerKwh: 211.23, landLow: 86.16, landHigh: 505.75 },
  { zone: "COK", label: "Cook Islands", year: 2024, avg: 250, avgLow: 212.5, avgHigh: 287.5, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.5, landCm2PerKwh: 180.0, landLow: 140.0, landHigh: 285.0 },
  { zone: "CO", label: "Colombia", year: 2025, avg: 186.8, avgLow: 158.8, avgHigh: 214.8, marginal: 641, marginalLow: 521, marginalHigh: 773, fossilShare: 0.23, landCm2PerKwh: 601.09, landLow: 214.79, landHigh: 1342.11 },
  { zone: "COM", label: "Comoros", year: 2023, avg: 642.9, avgLow: 546.4, avgHigh: 739.3, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 1.0, landCm2PerKwh: 120.0, landLow: 80.0, landHigh: 250.0 },
  { zone: "CPV", label: "Cape Verde", year: 2024, avg: 461.5, avgLow: 392.3, avgHigh: 530.8, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.692, landCm2PerKwh: 166.15, landLow: 88.15, landHigh: 406.92 },
  { zone: "CRI", label: "Costa Rica", year: 2025, avg: 24.2, avgLow: 20.6, avgHigh: 27.8, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: 517.45, landLow: 162.51, landHigh: 1329.3 },
  { zone: "CUB", label: "Cuba", year: 2024, avg: 642.8, avgLow: 546.4, avgHigh: 739.2, marginal: 670, marginalLow: 567, marginalHigh: 816, fossilShare: 0.96, landCm2PerKwh: 220.59, landLow: 111.25, landHigh: 411.44 },
  { zone: "CYM", label: "Cayman Islands", year: 2024, avg: 633.8, avgLow: 538.7, avgHigh: 728.9, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.958, landCm2PerKwh: 125.07, landLow: 85.07, landHigh: 252.96 },
  { zone: "CYP", label: "Cyprus", year: 2025, avg: 489, avgLow: 415.6, avgHigh: 562.3, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.723, landCm2PerKwh: 211.88, landLow: 124.93, landHigh: 388.82 },
  { zone: "CZ", label: "Czechia", year: 2025, avg: 401.5, avgLow: 341.2, avgHigh: 461.7, marginal: 888, marginalLow: 759, marginalHigh: 1034, fossilShare: 0.408, landCm2PerKwh: 551.97, landLow: 214.44, landHigh: 900.38 },
  { zone: "DE", label: "Germany", year: 2025, avg: 329.6, avgLow: 280.2, avgHigh: 379.1, marginal: 741, marginalLow: 618, marginalHigh: 879, fossilShare: 0.409, landCm2PerKwh: 780.58, landLow: 279.5, landHigh: 1453.44 },
  { zone: "DJI", label: "Djibouti", year: 2024, avg: 450, avgLow: 382.5, avgHigh: 517.5, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.65, landCm2PerKwh: 183.0, landLow: 56.55, landHigh: 582.5 },
  { zone: "DMA", label: "Dominica", year: 2023, avg: 600, avgLow: 510, avgHigh: 690, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.867, landCm2PerKwh: 184.0, landLow: 96.0, landHigh: 416.67 },
  { zone: "DK", label: "Denmark", year: 2025, avg: 114.4, avgLow: 97.2, avgHigh: 131.6, marginal: 718, marginalLow: 392, marginalHigh: 1160, fossilShare: 0.088, landCm2PerKwh: 1379.16, landLow: 442.2, landHigh: 2563.27 },
  { zone: "DOM", label: "Dominican Republic", year: 2025, avg: 537.5, avgLow: 456.9, avgHigh: 618.1, marginal: 722, marginalLow: 603, marginalHigh: 861, fossilShare: 0.762, landCm2PerKwh: 220.98, landLow: 108.11, landHigh: 476.38 },
  { zone: "DZA", label: "Algeria", year: 2024, avg: 632.9, avgLow: 538, avgHigh: 727.9, marginal: 491, marginalLow: 371, marginalHigh: 611, fossilShare: 0.989, landCm2PerKwh: 72.08, landLow: 42.79, landHigh: 192.02 },
  { zone: "ECU", label: "Ecuador", year: 2025, avg: 159, avgLow: 135.2, avgHigh: 182.9, marginal: 673, marginalLow: 570, marginalHigh: 819, fossilShare: 0.206, landCm2PerKwh: 543.29, landLow: 189.0, landHigh: 1303.61 },
  { zone: "EG", label: "Egypt", year: 2025, avg: 563.2, avgLow: 478.7, avgHigh: 647.7, marginal: 508, marginalLow: 389, marginalHigh: 630, fossilShare: 0.888, landCm2PerKwh: 116.13, landLow: 56.9, landHigh: 303.25 },
  { zone: "ERI", label: "Eritrea", year: 2024, avg: 577.8, avgLow: 491.1, avgHigh: 664.4, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.889, landCm2PerKwh: 133.33, landLow: 93.33, landHigh: 257.78 },
  { zone: "ES", label: "Spain", year: 2025, avg: 153.6, avgLow: 130.6, avgHigh: 176.6, marginal: 525, marginalLow: 407, marginalHigh: 649, fossilShare: 0.254, landCm2PerKwh: 331.02, landLow: 125.7, landHigh: 736.91 },
  { zone: "EE", label: "Estonia", year: 2025, avg: 319.1, avgLow: 271.3, avgHigh: 367, marginal: 693, marginalLow: 593, marginalHigh: 842, fossilShare: 0.404, landCm2PerKwh: 1414.17, landLow: 507.6, landHigh: 2351.77 },
  { zone: "ETH", label: "Ethiopia", year: 2025, avg: 23.1, avgLow: 19.6, avgHigh: 26.5, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: 590.73, landLow: 194.2, landHigh: 1489.73 },
  { zone: "FI", label: "Finland", year: 2025, avg: 57.5, avgLow: 48.8, avgHigh: 66.1, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: 908.95, landLow: 290.26, landHigh: 1700.3 },
  { zone: "FJI", label: "Fiji", year: 2024, avg: 278.3, avgLow: 236.5, avgHigh: 320, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.365, landCm2PerKwh: 964.17, landLow: 344.0, landHigh: 1815.83 },
  { zone: "FLK", label: "Falkland Islands", year: 2023, avg: 1000, avgLow: 850, avgHigh: 1150, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 1.0, landCm2PerKwh: 120.0, landLow: 80.0, landHigh: 250.0 },
  { zone: "FR", label: "France", year: 2025, avg: 41.4, avgLow: 35.2, avgHigh: 47.7, marginal: 591, marginalLow: 311, marginalHigh: 977, fossilShare: 0.051, landCm2PerKwh: 210.53, landLow: 72.6, landHigh: 447.33 },
  { zone: "FRO", label: "Faroe Islands", year: 2023, avg: 346.9, avgLow: 294.9, avgHigh: 399, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.531, landCm2PerKwh: 396.33, landLow: 138.71, landHigh: 934.69 },
  { zone: "GAB", label: "Gabon", year: 2024, avg: 523.1, avgLow: 444.6, avgHigh: 601.5, marginal: 556, marginalLow: 443, marginalHigh: 686, fossilShare: 0.646, landCm2PerKwh: 287.73, landLow: 112.13, landHigh: 694.62 },
  { zone: "GB", label: "United Kingdom", year: 2025, avg: 217.4, avgLow: 184.8, avgHigh: 250, marginal: 517, marginalLow: 400, marginalHigh: 641, fossilShare: 0.356, landCm2PerKwh: 960.37, landLow: 319.24, landHigh: 1741.51 },
  { zone: "GEO", label: "Georgia", year: 2025, avg: 145.9, avgLow: 124, avgHigh: 167.8, marginal: 490, marginalLow: 370, marginalHigh: 610, fossilShare: 0.204, landCm2PerKwh: 489.46, landLow: 166.5, landHigh: 1228.75 },
  { zone: "GHA", label: "Ghana", year: 2024, avg: 468.9, avgLow: 398.6, avgHigh: 539.2, marginal: 498, marginalLow: 378, marginalHigh: 619, fossilShare: 0.638, landCm2PerKwh: 264.89, landLow: 100.99, landHigh: 663.77 },
  { zone: "GIB", label: "Gibraltar", year: 2024, avg: 590.9, avgLow: 502.3, avgHigh: 679.5, marginal: 528, marginalLow: 412, marginalHigh: 654, fossilShare: 1.0, landCm2PerKwh: 79.09, landLow: 48.09, landHigh: 200.91 },
  { zone: "GIN", label: "Guinea", year: 2024, avg: 181.1, avgLow: 154, avgHigh: 208.3, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.248, landCm2PerKwh: 478.21, landLow: 170.22, landHigh: 1181.04 },
  { zone: "GLP", label: "Guadeloupe", year: 2023, avg: 497, avgLow: 422.5, avgHigh: 571.6, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: null, landLow: null, landHigh: null },
  { zone: "GMB", label: "Gambia", year: 2024, avg: 666.7, avgLow: 566.7, avgHigh: 766.7, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 1.0, landCm2PerKwh: 120.0, landLow: 80.0, landHigh: 250.0 },
  { zone: "GNB", label: "Guinea-Bissau", year: 2024, avg: 625, avgLow: 531.2, avgHigh: 718.8, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 1.0, landCm2PerKwh: 120.0, landLow: 80.0, landHigh: 250.0 },
  { zone: "GNQ", label: "Equatorial Guinea", year: 2024, avg: 644.3, avgLow: 547.7, avgHigh: 740.9, marginal: 492, marginalLow: 372, marginalHigh: 612, fossilShare: 0.732, landCm2PerKwh: 212.62, landLow: 83.95, landHigh: 542.08 },
  { zone: "GR", label: "Greece", year: 2025, avg: 315.1, avgLow: 267.8, avgHigh: 362.4, marginal: 563, marginalLow: 445, marginalHigh: 690, fossilShare: 0.503, landCm2PerKwh: 262.98, landLow: 109.31, landHigh: 618.97 },
  { zone: "GRD", label: "Grenada", year: 2024, avg: 666.7, avgLow: 566.7, avgHigh: 766.7, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 1.0, landCm2PerKwh: 120.0, landLow: 80.0, landHigh: 250.0 },
  { zone: "GRL", label: "Greenland", year: 2024, avg: 150, avgLow: 127.5, avgHigh: 172.5, marginal: 700, marginalLow: 390, marginalHigh: 1148, fossilShare: 0.167, landCm2PerKwh: 780.0, landLow: 270.0, landHigh: 1666.67 },
  { zone: "GTM", label: "Guatemala", year: 2024, avg: 301.5, avgLow: 256.2, avgHigh: 346.7, marginal: 825, marginalLow: 710, marginalHigh: 975, fossilShare: 0.317, landCm2PerKwh: 1579.7, landLow: 555.57, landHigh: 2717.52 },
  { zone: "GUF", label: "French Guiana", year: 2023, avg: 244.9, avgLow: 208.2, avgHigh: 281.6, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: null, landLow: null, landHigh: null },
  { zone: "GUM", label: "Guam", year: 2024, avg: 607.5, avgLow: 516.4, avgHigh: 698.7, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.914, landCm2PerKwh: 130.32, landLow: 90.32, landHigh: 256.02 },
  { zone: "GUY", label: "Guyana", year: 2024, avg: 644.9, avgLow: 548.2, avgHigh: 741.7, marginal: 698, marginalLow: 598, marginalHigh: 848, fossilShare: 0.971, landCm2PerKwh: 203.7, landLow: 109.28, landHigh: 377.39 },
  { zone: "HK", label: "Hong Kong", year: 2024, avg: 675.5, avgLow: 574.2, avgHigh: 776.8, marginal: 649, marginalLow: 526, marginalHigh: 780, fossilShare: 0.99, landCm2PerKwh: 123.06, landLow: 70.67, landHigh: 266.19 },
  { zone: "HND", label: "Honduras", year: 2024, avg: 322.1, avgLow: 273.8, avgHigh: 370.4, marginal: 703, marginalLow: 602, marginalHigh: 853, fossilShare: 0.446, landCm2PerKwh: 668.25, landLow: 251.08, landHigh: 1280.7 },
  { zone: "HR", label: "Croatia", year: 2025, avg: 158.5, avgLow: 134.7, avgHigh: 182.3, marginal: 586, marginalLow: 464, marginalHigh: 712, fossilShare: 0.237, landCm2PerKwh: 736.01, landLow: 247.56, landHigh: 1536.82 },
  { zone: "HTI", label: "Haiti", year: 2024, avg: 534.9, avgLow: 454.6, avgHigh: 615.1, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.814, landCm2PerKwh: 209.3, landLow: 102.33, landHigh: 482.56 },
  { zone: "HU", label: "Hungary", year: 2025, avg: 163, avgLow: 138.6, avgHigh: 187.5, marginal: 562, marginalLow: 442, marginalHigh: 688, fossilShare: 0.247, landCm2PerKwh: 438.87, landLow: 187.51, landHigh: 700.62 },
  { zone: "ID", label: "Indonesia", year: 2024, avg: 680.2, avgLow: 578.2, avgHigh: 782.3, marginal: 840, marginalLow: 713, marginalHigh: 983, fossilShare: 0.819, landCm2PerKwh: 487.13, landLow: 201.08, landHigh: 860.72 },
  { zone: "IN", label: "India", year: 2025, avg: 670.1, avgLow: 569.6, avgHigh: 770.6, marginal: 935, marginalLow: 805, marginalHigh: 1084, fossilShare: 0.733, landCm2PerKwh: 261.2, landLow: 130.67, landHigh: 535.37 },
  { zone: "IE", label: "Ireland", year: 2025, avg: 256.5, avgLow: 218.1, avgHigh: 295, marginal: 507, marginalLow: 388, marginalHigh: 629, fossilShare: 0.519, landCm2PerKwh: 367.34, landLow: 107.28, landHigh: 900.15 },
  { zone: "IRN", label: "Iran", year: 2025, avg: 659.5, avgLow: 560.6, avgHigh: 758.5, marginal: 501, marginalLow: 382, marginalHigh: 623, fossilShare: 0.943, landCm2PerKwh: 90.15, landLow: 47.8, landHigh: 236.75 },
  { zone: "IRQ", label: "Iraq", year: 2024, avg: 683.1, avgLow: 580.6, avgHigh: 785.6, marginal: 587, marginalLow: 476, marginalHigh: 721, fossilShare: 0.984, landCm2PerKwh: 100.28, landLow: 61.29, landHigh: 235.12 },
  { zone: "IS", label: "Iceland", year: 2024, avg: 27.8, avgLow: 23.6, avgHigh: 32, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: 432.99, landLow: 142.89, landHigh: 1104.5 },
  { zone: "IL", label: "Israel", year: 2025, avg: 492.7, avgLow: 418.8, avgHigh: 566.6, marginal: 509, marginalLow: 388, marginalHigh: 630, fossilShare: 0.831, landCm2PerKwh: 112.68, landLow: 72.39, landHigh: 237.61 },
  { zone: "IT", label: "Italy", year: 2025, avg: 284.8, avgLow: 242.1, avgHigh: 327.5, marginal: 513, marginalLow: 394, marginalHigh: 636, fossilShare: 0.512, landCm2PerKwh: 540.29, landLow: 207.17, landHigh: 1022.03 },
  { zone: "JAM", label: "Jamaica", year: 2024, avg: 563, avgLow: 478.6, avgHigh: 647.5, marginal: 563, marginalLow: 450, marginalHigh: 694, fossilShare: 0.874, landCm2PerKwh: 186.79, landLow: 83.86, landHigh: 411.18 },
  { zone: "JOR", label: "Jordan", year: 2024, avg: 529.8, avgLow: 450.3, avgHigh: 609.3, marginal: 529, marginalLow: 412, marginalHigh: 654, fossilShare: 0.759, landCm2PerKwh: 122.65, landLow: 70.9, landHigh: 295.73 },
  { zone: "JP", label: "Japan", year: 2025, avg: 477.3, avgLow: 405.7, avgHigh: 548.8, marginal: 717, marginalLow: 593, marginalHigh: 852, fossilShare: 0.673, landCm2PerKwh: 453.74, landLow: 188.32, landHigh: 798.78 },
  { zone: "KAZ", label: "Kazakhstan", year: 2025, avg: 805.3, avgLow: 684.5, avgHigh: 926.1, marginal: 787, marginalLow: 661, marginalHigh: 926, fossilShare: 0.848, landCm2PerKwh: 176.48, landLow: 89.89, landHigh: 418.57 },
  { zone: "KE", label: "Kenya", year: 2025, avg: 95.4, avgLow: 81.1, avgHigh: 109.8, marginal: 700, marginalLow: 390, marginalHigh: 1148, fossilShare: 0.1, landCm2PerKwh: 335.58, landLow: 106.28, landHigh: 811.65 },
  { zone: "KGZ", label: "Kyrgyzstan", year: 2025, avg: 152.7, avgLow: 129.8, avgHigh: 175.6, marginal: 883, marginalLow: 491, marginalHigh: 1390, fossilShare: 0.153, landCm2PerKwh: 529.62, landLow: 183.53, landHigh: 1314.37 },
  { zone: "KHM", label: "Cambodia", year: 2025, avg: 498.9, avgLow: 424, avgHigh: 573.7, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: null, landLow: null, landHigh: null },
  { zone: "KIR", label: "Kiribati", year: 2024, avg: 500, avgLow: 425, avgHigh: 575, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.75, landCm2PerKwh: 150.0, landLow: 110.0, landHigh: 267.5 },
  { zone: "KNA", label: "Saint Kitts and Nevis", year: 2024, avg: 608.7, avgLow: 517.4, avgHigh: 700, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.913, landCm2PerKwh: 133.04, landLow: 82.3, landHigh: 294.35 },
  { zone: "KR", label: "South Korea", year: 2025, avg: 417.1, avgLow: 354.5, avgHigh: 479.6, marginal: 732, marginalLow: 607, marginalHigh: 868, fossilShare: 0.6, landCm2PerKwh: 270.52, landLow: 120.01, landHigh: 468.82 },
  { zone: "KWT", label: "Kuwait", year: 2025, avg: 635.3, avgLow: 540, avgHigh: 730.6, marginal: 567, marginalLow: 454, marginalHigh: 698, fossilShare: 0.978, landCm2PerKwh: 92.89, landLow: 54.74, landHigh: 232.06 },
  { zone: "LAO", label: "Laos", year: 2024, avg: 232.1, avgLow: 197.3, avgHigh: 266.9, marginal: 950, marginalLow: 820, marginalHigh: 1100, fossilShare: 0.233, landCm2PerKwh: 498.58, landLow: 178.09, landHigh: 1224.29 },
  { zone: "LBN", label: "Lebanon", year: 2024, avg: 389.5, avgLow: 331.1, avgHigh: 447.9, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.562, landCm2PerKwh: 251.12, landLow: 142.35, landHigh: 485.77 },
  { zone: "LBR", label: "Liberia", year: 2024, avg: 315.8, avgLow: 268.4, avgHigh: 363.2, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.456, landCm2PerKwh: 374.74, landLow: 145.26, landHigh: 909.12 },
  { zone: "LBY", label: "Libya", year: 2024, avg: 826.8, avgLow: 702.8, avgHigh: 950.9, marginal: 543, marginalLow: 429, marginalHigh: 671, fossilShare: 1.0, landCm2PerKwh: 82.77, landLow: 50.97, landHigh: 205.3 },
  { zone: "LCA", label: "Saint Lucia", year: 2024, avg: 650, avgLow: 552.5, avgHigh: 747.5, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.975, landCm2PerKwh: 123.0, landLow: 83.0, landHigh: 251.75 },
  { zone: "LKA", label: "Sri Lanka", year: 2025, avg: 329.3, avgLow: 279.9, avgHigh: 378.7, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: null, landLow: null, landHigh: null },
  { zone: "LSO", label: "Lesotho", year: 2022, avg: 20.8, avgLow: 17.7, avgHigh: 24, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: null, landLow: null, landHigh: null },
  { zone: "LT", label: "Lithuania", year: 2025, avg: 138.4, avgLow: 117.6, avgHigh: 159.1, marginal: 545, marginalLow: 430, marginalHigh: 673, fossilShare: 0.224, landCm2PerKwh: 802.6, landLow: 262.96, landHigh: 1604.8 },
  { zone: "LU", label: "Luxembourg", year: 2025, avg: 123.4, avgLow: 104.9, avgHigh: 141.9, marginal: 603, marginalLow: 321, marginalHigh: 998, fossilShare: 0.084, landCm2PerKwh: 1774.29, landLow: 622.19, landHigh: 2985.91 },
  { zone: "LV", label: "Latvia", year: 2025, avg: 138.8, avgLow: 117.9, avgHigh: 159.6, marginal: 496, marginalLow: 377, marginalHigh: 617, fossilShare: 0.27, landCm2PerKwh: 905.84, landLow: 326.01, landHigh: 1712.2 },
  { zone: "MAC", label: "Macao", year: 2024, avg: 474.4, avgLow: 403.2, avgHigh: 545.5, marginal: 509, marginalLow: 391, marginalHigh: 632, fossilShare: 0.692, landCm2PerKwh: 1836.28, landLow: 646.27, landHigh: 2904.62 },
  { zone: "MA", label: "Morocco", year: 2025, avg: 596.4, avgLow: 506.9, avgHigh: 685.9, marginal: 872, marginalLow: 745, marginalHigh: 1018, fossilShare: 0.76, landCm2PerKwh: 183.72, landLow: 88.4, landHigh: 464.1 },
  { zone: "MDA", label: "Moldova", year: 2025, avg: 633.1, avgLow: 538.2, avgHigh: 728.1, marginal: 498, marginalLow: 379, marginalHigh: 620, fossilShare: 0.888, landCm2PerKwh: 130.89, landLow: 61.19, landHigh: 324.79 },
  { zone: "MDG", label: "Madagascar", year: 2024, avg: 432.1, avgLow: 367.3, avgHigh: 496.9, marginal: 789, marginalLow: 679, marginalHigh: 939, fossilShare: 0.576, landCm2PerKwh: 379.01, landLow: 157.2, landHigh: 834.16 },
  { zone: "MDV", label: "Maldives", year: 2024, avg: 611.8, avgLow: 520, avgHigh: 703.5, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.929, landCm2PerKwh: 128.47, landLow: 88.47, landHigh: 254.94 },
  { zone: "MX", label: "Mexico", year: 2025, avg: 474, avgLow: 402.9, avgHigh: 545.1, marginal: 536, marginalLow: 418, marginalHigh: 661, fossilShare: 0.741, landCm2PerKwh: 239.86, landLow: 100.89, landHigh: 516.34 },
  { zone: "MKD", label: "North Macedonia", year: 2025, avg: 441.4, avgLow: 375.1, avgHigh: 507.6, marginal: 767, marginalLow: 642, marginalHigh: 906, fossilShare: 0.528, landCm2PerKwh: 282.18, landLow: 140.2, landHigh: 598.61 },
  { zone: "MLI", label: "Mali", year: 2024, avg: 538.6, avgLow: 457.8, avgHigh: 619.4, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.805, landCm2PerKwh: 264.23, landLow: 124.5, landHigh: 547.72 },
  { zone: "MLT", label: "Malta", year: 2025, avg: 484, avgLow: 411.4, avgHigh: 556.6, marginal: 492, marginalLow: 372, marginalHigh: 613, fossilShare: 0.84, landCm2PerKwh: 123.01, landLow: 74.99, landHigh: 250.96 },
  { zone: "MMR", label: "Myanmar", year: 2024, avg: 503, avgLow: 427.5, avgHigh: 578.4, marginal: 541, marginalLow: 420, marginalHigh: 664, fossilShare: 0.521, landCm2PerKwh: 391.03, landLow: 142.96, landHigh: 910.11 },
  { zone: "MNE", label: "Montenegro", year: 2025, avg: 264.2, avgLow: 224.6, avgHigh: 303.9, marginal: 950, marginalLow: 820, marginalHigh: 1100, fossilShare: 0.244, landCm2PerKwh: 435.61, landLow: 154.33, landHigh: 1106.02 },
  { zone: "MNG", label: "Mongolia", year: 2025, avg: 816.3, avgLow: 693.9, avgHigh: 938.8, marginal: 934, marginalLow: 806, marginalHigh: 1084, fossilShare: 0.916, landCm2PerKwh: 161.33, landLow: 96.76, landHigh: 355.08 },
  { zone: "MOZ", label: "Mozambique", year: 2024, avg: 129.4, avgLow: 110, avgHigh: 148.8, marginal: 500, marginalLow: 247, marginalHigh: 838, fossilShare: 0.166, landCm2PerKwh: 545.24, landLow: 185.77, landHigh: 1327.83 },
  { zone: "MRT", label: "Mauritania", year: 2024, avg: 512.1, avgLow: 435.3, avgHigh: 588.9, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.773, landCm2PerKwh: 186.67, landLow: 98.21, landHigh: 428.12 },
  { zone: "MSR", label: "Montserrat", year: 2024, avg: 1000, avgLow: 850, avgHigh: 1150, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 1.0, landCm2PerKwh: 120.0, landLow: 80.0, landHigh: 250.0 },
  { zone: "MTQ", label: "Martinique", year: 2023, avg: 529.8, avgLow: 450.3, avgHigh: 609.3, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: null, landLow: null, landHigh: null },
  { zone: "MUS", label: "Mauritius", year: 2024, avg: 642.2, avgLow: 545.9, avgHigh: 738.6, marginal: 820, marginalLow: 705, marginalHigh: 970, fossilShare: 0.821, landCm2PerKwh: 686.8, landLow: 277.69, landHigh: 1137.36 },
  { zone: "MWI", label: "Malawi", year: 2024, avg: 54.6, avgLow: 46.5, avgHigh: 62.8, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: 719.13, landLow: 243.93, landHigh: 1643.83 },
  { zone: "MY", label: "Malaysia", year: 2025, avg: 602, avgLow: 511.7, avgHigh: 692.3, marginal: 740, marginalLow: 615, marginalHigh: 877, fossilShare: 0.796, landCm2PerKwh: 250.07, landLow: 114.55, landHigh: 544.7 },
  { zone: "NAM", label: "Namibia", year: 2024, avg: 48.8, avgLow: 41.5, avgHigh: 56.1, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: 458.05, landLow: 195.28, landHigh: 1049.76 },
  { zone: "NCL", label: "New Caledonia", year: 2024, avg: 560.9, avgLow: 476.8, avgHigh: 645, marginal: 825, marginalLow: 710, marginalHigh: 975, fossilShare: 0.731, landCm2PerKwh: 226.35, landLow: 117.22, landHigh: 502.63 },
  { zone: "NER", label: "Niger", year: 2024, avg: 673.7, avgLow: 572.6, avgHigh: 774.7, marginal: 735, marginalLow: 628, marginalHigh: 883, fossilShare: 0.968, landCm2PerKwh: 126.53, landLow: 85.32, landHigh: 258.0 },
  { zone: "NG", label: "Nigeria", year: 2025, avg: 455.7, avgLow: 387.4, avgHigh: 524.1, marginal: 490, marginalLow: 370, marginalHigh: 610, fossilShare: 0.687, landCm2PerKwh: 242.38, landLow: 93.4, landHigh: 607.42 },
  { zone: "NIC", label: "Nicaragua", year: 2024, avg: 300.9, avgLow: 255.8, avgHigh: 346, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.376, landCm2PerKwh: 1316.79, landLow: 456.36, landHigh: 2255.55 },
  { zone: "NL", label: "Netherlands", year: 2025, avg: 253.6, avgLow: 215.5, avgHigh: 291.6, marginal: 579, marginalLow: 459, marginalHigh: 706, fossilShare: 0.458, landCm2PerKwh: 459.92, landLow: 171.57, landHigh: 921.86 },
  { zone: "NO", label: "Norway", year: 2025, avg: 28.1, avgLow: 23.9, avgHigh: 32.3, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: 575.84, landLow: 185.38, landHigh: 1468.32 },
  { zone: "NPL", label: "Nepal", year: 2024, avg: 24.3, avgLow: 20.6, avgHigh: 27.9, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: 595.85, landLow: 199.83, landHigh: 1487.01 },
  { zone: "NRU", label: "Nauru", year: 2024, avg: 600, avgLow: 510, avgHigh: 690, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.8, landCm2PerKwh: 144.0, landLow: 104.0, landHigh: 264.0 },
  { zone: "NZ", label: "New Zealand", year: 2025, avg: 92.8, avgLow: 78.8, avgHigh: 106.7, marginal: 562, marginalLow: 289, marginalHigh: 930, fossilShare: 0.115, landCm2PerKwh: 452.82, landLow: 146.0, landHigh: 1117.21 },
  { zone: "OMN", label: "Oman", year: 2025, avg: 544.5, avgLow: 462.8, avgHigh: 626.1, marginal: 498, marginalLow: 379, marginalHigh: 619, fossilShare: 0.955, landCm2PerKwh: 79.63, landLow: 49.27, landHigh: 199.73 },
  { zone: "PAK", label: "Pakistan", year: 2025, avg: 346.6, avgLow: 294.6, avgHigh: 398.5, marginal: 684, marginalLow: 565, marginalHigh: 820, fossilShare: 0.451, landCm2PerKwh: 272.79, landLow: 126.32, landHigh: 582.92 },
  { zone: "PAN", label: "Panama", year: 2024, avg: 221.2, avgLow: 188, avgHigh: 254.3, marginal: 592, marginalLow: 476, marginalHigh: 723, fossilShare: 0.32, landCm2PerKwh: 408.38, landLow: 147.53, landHigh: 1008.62 },
  { zone: "PE", label: "Peru", year: 2025, avg: 238.2, avgLow: 202.5, avgHigh: 274, marginal: 491, marginalLow: 372, marginalHigh: 612, fossilShare: 0.364, landCm2PerKwh: 442.02, landLow: 155.13, landHigh: 1058.42 },
  { zone: "PH", label: "Philippines", year: 2025, avg: 588.3, avgLow: 500, avgHigh: 676.5, marginal: 844, marginalLow: 717, marginalHigh: 987, fossilShare: 0.767, landCm2PerKwh: 243.06, landLow: 115.98, landHigh: 505.74 },
  { zone: "PNG", label: "Papua New Guinea", year: 2024, avg: 513.7, avgLow: 436.7, avgHigh: 590.8, marginal: 647, marginalLow: 542, marginalHigh: 790, fossilShare: 0.763, landCm2PerKwh: 222.22, landLow: 100.59, landHigh: 519.26 },
  { zone: "PL", label: "Poland", year: 2025, avg: 588.6, avgLow: 500.3, avgHigh: 676.9, marginal: 840, marginalLow: 714, marginalHigh: 984, fossilShare: 0.685, landCm2PerKwh: 449.66, landLow: 183.56, landHigh: 849.88 },
  { zone: "PRI", label: "Puerto Rico", year: 2025, avg: 654.7, avgLow: 556.5, avgHigh: 752.9, marginal: 678, marginalLow: 566, marginalHigh: 819, fossilShare: 0.936, landCm2PerKwh: 122.16, landLow: 78.2, landHigh: 262.2 },
  { zone: "PRK", label: "North Korea", year: 2024, avg: 340.6, avgLow: 289.5, avgHigh: 391.7, marginal: 932, marginalLow: 804, marginalHigh: 1082, fossilShare: 0.366, landCm2PerKwh: 432.08, landLow: 162.84, landHigh: 1051.6 },
  { zone: "PT", label: "Portugal", year: 2025, avg: 127.9, avgLow: 108.7, avgHigh: 147.1, marginal: 519, marginalLow: 261, marginalHigh: 868, fossilShare: 0.19, landCm2PerKwh: 709.46, landLow: 242.49, landHigh: 1472.54 },
  { zone: "PRY", label: "Paraguay", year: 2025, avg: 24.7, avgLow: 21, avgHigh: 28.4, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: 627.52, landLow: 209.53, landHigh: 1539.69 },
  { zone: "PSE", label: "Palestine", year: 2024, avg: 414.1, avgLow: 352, avgHigh: 476.3, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.606, landCm2PerKwh: 167.27, landLow: 127.27, landHigh: 277.58 },
  { zone: "PYF", label: "French Polynesia", year: 2024, avg: 430.6, avgLow: 366, avgHigh: 495.1, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.653, landCm2PerKwh: 256.67, landLow: 121.67, landHigh: 585.69 },
  { zone: "QAT", label: "Qatar", year: 2025, avg: 581.5, avgLow: 494.3, avgHigh: 668.7, marginal: 490, marginalLow: 370, marginalHigh: 610, fossilShare: 0.959, landCm2PerKwh: 89.77, landLow: 51.62, landHigh: 215.36 },
  { zone: "REU", label: "Reunion", year: 2023, avg: 394.1, avgLow: 335, avgHigh: 453.3, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: null, landLow: null, landHigh: null },
  { zone: "RO", label: "Romania", year: 2025, avg: 250.8, avgLow: 213.1, avgHigh: 288.4, marginal: 682, marginalLow: 558, marginalHigh: 815, fossilShare: 0.325, landCm2PerKwh: 296.05, landLow: 110.89, landHigh: 705.0 },
  { zone: "RU", label: "Russia", year: 2025, avg: 449.7, avgLow: 382.3, avgHigh: 517.2, marginal: 626, marginalLow: 503, marginalHigh: 755, fossilShare: 0.643, landCm2PerKwh: 166.27, landLow: 73.13, landHigh: 405.04 },
  { zone: "RWA", label: "Rwanda", year: 2024, avg: 354, avgLow: 300.9, avgHigh: 407.1, marginal: 664, marginalLow: 545, marginalHigh: 798, fossilShare: 0.504, landCm2PerKwh: 336.37, landLow: 132.12, landHigh: 819.29 },
  { zone: "SA", label: "Saudi Arabia", year: 2024, avg: 692, avgLow: 588.2, avgHigh: 795.7, marginal: 612, marginalLow: 504, marginalHigh: 749, fossilShare: 1.0, landCm2PerKwh: 99.05, landLow: 63.66, landHigh: 224.85 },
  { zone: "SDN", label: "Sudan", year: 2024, avg: 153.7, avgLow: 130.6, avgHigh: 176.7, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.203, landCm2PerKwh: 537.33, landLow: 189.03, landHigh: 1289.18 },
  { zone: "SEN", label: "Senegal", year: 2024, avg: 540, avgLow: 459, avgHigh: 621, marginal: 703, marginalLow: 603, marginalHigh: 853, fossilShare: 0.802, landCm2PerKwh: 242.02, landLow: 119.81, landHigh: 484.72 },
  { zone: "SG", label: "Singapore", year: 2025, avg: 497.1, avgLow: 422.5, avgHigh: 571.7, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: null, landLow: null, landHigh: null },
  { zone: "SHN", label: "Saint Helena", year: 2023, avg: 1000, avgLow: 850, avgHigh: 1150, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 1.0, landCm2PerKwh: 120.0, landLow: 80.0, landHigh: 250.0 },
  { zone: "SLB", label: "Solomon Islands", year: 2024, avg: 636.4, avgLow: 540.9, avgHigh: 731.8, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.909, landCm2PerKwh: 130.91, landLow: 90.91, landHigh: 256.36 },
  { zone: "SLE", label: "Sierra Leone", year: 2024, avg: 47.6, avgLow: 40.5, avgHigh: 54.8, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: 542.86, landLow: 194.29, landHigh: 1328.1 },
  { zone: "SLV", label: "El Salvador", year: 2025, avg: 139.3, avgLow: 118.4, avgHigh: 160.2, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: null, landLow: null, landHigh: null },
  { zone: "SOM", label: "Somalia", year: 2024, avg: 511.6, avgLow: 434.9, avgHigh: 588.4, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.791, landCm2PerKwh: 146.51, landLow: 100.77, landHigh: 285.12 },
  { zone: "SPM", label: "Saint Pierre and Miquelon", year: 2023, avg: 600, avgLow: 510, avgHigh: 690, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 1.0, landCm2PerKwh: 120.0, landLow: 80.0, landHigh: 250.0 },
  { zone: "SRB", label: "Serbia", year: 2025, avg: 695.8, avgLow: 591.4, avgHigh: 800.2, marginal: 905, marginalLow: 776, marginalHigh: 1052, fossilShare: 0.722, landCm2PerKwh: 314.13, landLow: 136.34, landHigh: 692.67 },
  { zone: "SSD", label: "South Sudan", year: 2024, avg: 642.9, avgLow: 546.4, avgHigh: 739.3, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.982, landCm2PerKwh: 122.14, landLow: 82.14, landHigh: 251.25 },
  { zone: "STP", label: "Sao Tome and Principe", year: 2023, avg: 555.6, avgLow: 472.2, avgHigh: 638.9, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.889, landCm2PerKwh: 173.33, landLow: 93.33, landHigh: 388.89 },
  { zone: "SUR", label: "Suriname", year: 2024, avg: 321.8, avgLow: 273.6, avgHigh: 370.1, marginal: 695, marginalLow: 594, marginalHigh: 844, fossilShare: 0.471, landCm2PerKwh: 401.03, landLow: 153.34, landHigh: 946.55 },
  { zone: "SK", label: "Slovakia", year: 2025, avg: 94.8, avgLow: 80.6, avgHigh: 109.1, marginal: 558, marginalLow: 287, marginalHigh: 926, fossilShare: 0.148, landCm2PerKwh: 399.15, landLow: 143.29, landHigh: 691.84 },
  { zone: "SI", label: "Slovenia", year: 2025, avg: 183.3, avgLow: 155.8, avgHigh: 210.8, marginal: 810, marginalLow: 683, marginalHigh: 951, fossilShare: 0.211, landCm2PerKwh: 328.78, landLow: 131.89, landHigh: 675.46 },
  { zone: "SE", label: "Sweden", year: 2025, avg: 35.3, avgLow: 30, avgHigh: 40.5, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: 654.59, landLow: 205.94, landHigh: 1410.16 },
  { zone: "SWZ", label: "Eswatini", year: 2024, avg: 131.2, avgLow: 111.5, avgHigh: 150.8, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: 2357.7, landLow: 816.39, landHigh: 3984.59 },
  { zone: "SYC", label: "Seychelles", year: 2024, avg: 555.6, avgLow: 472.2, avgHigh: 638.9, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.841, landCm2PerKwh: 140.0, landLow: 96.08, landHigh: 275.08 },
  { zone: "SYR", label: "Syria", year: 2024, avg: 706.2, avgLow: 600.3, avgHigh: 812.1, marginal: 586, marginalLow: 475, marginalHigh: 720, fossilShare: 0.965, landCm2PerKwh: 115.68, landLow: 66.04, landHigh: 267.16 },
  { zone: "TCA", label: "Turks and Caicos Islands", year: 2024, avg: 629.6, avgLow: 535.2, avgHigh: 724.1, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.963, landCm2PerKwh: 124.44, landLow: 84.44, landHigh: 252.59 },
  { zone: "TCD", label: "Chad", year: 2024, avg: 621.6, avgLow: 528.4, avgHigh: 714.9, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.946, landCm2PerKwh: 278.38, landLow: 130.08, landHigh: 512.16 },
  { zone: "TGO", label: "Togo", year: 2024, avg: 422.5, avgLow: 359.2, avgHigh: 485.9, marginal: 490, marginalLow: 370, marginalHigh: 610, fossilShare: 0.704, landCm2PerKwh: 160.85, landLow: 88.03, landHigh: 361.41 },
  { zone: "TH", label: "Thailand", year: 2025, avg: 545.7, avgLow: 463.9, avgHigh: 627.6, marginal: 580, marginalLow: 458, marginalHigh: 706, fossilShare: 0.852, landCm2PerKwh: 522.22, landLow: 201.14, landHigh: 906.56 },
  { zone: "TJK", label: "Tajikistan", year: 2025, avg: 72.6, avgLow: 61.7, avgHigh: 83.4, marginal: 871, marginalLow: 482, marginalHigh: 1371, fossilShare: 0.056, landCm2PerKwh: 573.87, landLow: 193.79, landHigh: 1431.32 },
  { zone: "TKM", label: "Turkmenistan", year: 2024, avg: 1306.3, avgLow: 1110.3, avgHigh: 1502.2, marginal: 490, marginalLow: 370, marginalHigh: 610, fossilShare: 1.0, landCm2PerKwh: 70.16, landLow: 41.05, landHigh: 190.4 },
  { zone: "TLS", label: "East Timor", year: 2024, avg: 666.7, avgLow: 566.7, avgHigh: 766.7, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 1.0, landCm2PerKwh: 120.0, landLow: 80.0, landHigh: 250.0 },
  { zone: "TON", label: "Tonga", year: 2024, avg: 571.4, avgLow: 485.7, avgHigh: 657.1, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.857, landCm2PerKwh: 137.14, landLow: 97.14, landHigh: 260.0 },
  { zone: "TTO", label: "Trinidad and Tobago", year: 2024, avg: 681.7, avgLow: 579.4, avgHigh: 783.9, marginal: 491, marginalLow: 371, marginalHigh: 611, fossilShare: 0.999, landCm2PerKwh: 70.39, landLow: 41.33, landHigh: 190.39 },
  { zone: "TUN", label: "Tunisia", year: 2025, avg: 560.3, avgLow: 476.2, avgHigh: 644.3, marginal: 492, marginalLow: 372, marginalHigh: 613, fossilShare: 0.96, landCm2PerKwh: 78.42, landLow: 45.05, landHigh: 209.41 },
  { zone: "TR", label: "Turkey", year: 2025, avg: 474.7, avgLow: 403.5, avgHigh: 546, marginal: 769, marginalLow: 643, marginalHigh: 907, fossilShare: 0.567, landCm2PerKwh: 363.0, landLow: 146.57, landHigh: 776.05 },
  { zone: "TW", label: "Taiwan", year: 2025, avg: 633.2, avgLow: 538.2, avgHigh: 728.2, marginal: 686, marginalLow: 563, marginalHigh: 819, fossilShare: 0.866, landCm2PerKwh: 169.7, landLow: 87.34, landHigh: 367.04 },
  { zone: "TZA", label: "Tanzania", year: 2024, avg: 345, avgLow: 293.3, avgHigh: 396.8, marginal: 503, marginalLow: 385, marginalHigh: 625, fossilShare: 0.671, landCm2PerKwh: 286.17, landLow: 109.27, landHigh: 677.86 },
  { zone: "UGA", label: "Uganda", year: 2024, avg: 58.5, avgLow: 49.7, avgHigh: 67.3, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: 996.08, landLow: 342.1, landHigh: 2035.61 },
  { zone: "UA", label: "Ukraine", year: 2022, avg: 250.5, avgLow: 212.9, avgHigh: 288, marginal: 839, marginalLow: 712, marginalHigh: 982, fossilShare: 0.278, landCm2PerKwh: 151.74, landLow: 67.36, landHigh: 318.61 },
  { zone: "URY", label: "Uruguay", year: 2025, avg: 80.4, avgLow: 68.3, avgHigh: 92.5, marginal: null, marginalLow: null, marginalHigh: null, fossilShare: null, landCm2PerKwh: 1742.76, landLow: 569.17, landHigh: 3156.21 },
  { zone: "US", label: "United States", year: 2025, avg: 384.4, avgLow: 326.7, avgHigh: 442.1, marginal: 624, marginalLow: 502, marginalHigh: 753, fossilShare: 0.57, landCm2PerKwh: 196.45, landLow: 83.08, landHigh: 450.69 },
  { zone: "UZB", label: "Uzbekistan", year: 2025, avg: 1000, avgLow: 850, avgHigh: 1150, marginal: 532, marginalLow: 412, marginalHigh: 655, fossilShare: 0.806, landCm2PerKwh: 137.99, landLow: 67.74, landHigh: 349.8 },
  { zone: "VCT", label: "Saint Vincent and the Grenadines", year: 2024, avg: 600, avgLow: 510, avgHigh: 690, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.867, landCm2PerKwh: 184.0, landLow: 96.0, landHigh: 416.67 },
  { zone: "VEN", label: "Venezuela", year: 2024, avg: 85.9, avgLow: 73, avgHigh: 98.7, marginal: 594, marginalLow: 314, marginalHigh: 983, fossilShare: 0.089, landCm2PerKwh: 555.1, landLow: 187.57, landHigh: 1386.32 },
  { zone: "VGB", label: "British Virgin Islands", year: 2023, avg: 647.1, avgLow: 550, avgHigh: 744.1, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 1.0, landCm2PerKwh: 120.0, landLow: 80.0, landHigh: 250.0 },
  { zone: "VIR", label: "United States Virgin Islands", year: 2023, avg: 632.4, avgLow: 537.5, avgHigh: 727.2, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.971, landCm2PerKwh: 123.53, landLow: 83.53, landHigh: 252.06 },
  { zone: "VN", label: "Vietnam", year: 2025, avg: 460.7, avgLow: 391.6, avgHigh: 529.8, marginal: 897, marginalLow: 768, marginalHigh: 1043, fossilShare: 0.546, landCm2PerKwh: 325.94, landLow: 139.01, landHigh: 761.36 },
  { zone: "VUT", label: "Vanuatu", year: 2023, avg: 500, avgLow: 425, avgHigh: 575, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.75, landCm2PerKwh: 195.0, landLow: 110.0, landHigh: 415.0 },
  { zone: "WSM", label: "Samoa", year: 2024, avg: 375, avgLow: 318.8, avgHigh: 431.2, marginal: 700, marginalLow: 600, marginalHigh: 850, fossilShare: 0.562, landCm2PerKwh: 587.5, landLow: 245.0, landHigh: 1044.38 },
  { zone: "YEM", label: "Yemen", year: 2024, avg: 592.4, avgLow: 503.5, avgHigh: 681.2, marginal: 697, marginalLow: 597, marginalHigh: 847, fossilShare: 0.888, landCm2PerKwh: 132.91, landLow: 93.04, landHigh: 257.18 },
  { zone: "ZA", label: "South Africa", year: 2025, avg: 699.3, avgLow: 594.4, avgHigh: 804.2, marginal: 948, marginalLow: 818, marginalHigh: 1098, fossilShare: 0.822, landCm2PerKwh: 172.05, landLow: 104.06, landHigh: 356.55 },
  { zone: "ZMB", label: "Zambia", year: 2024, avg: 119.7, avgLow: 101.7, avgHigh: 137.6, marginal: 916, marginalLow: 513, marginalHigh: 1439, fossilShare: 0.125, landCm2PerKwh: 561.11, landLow: 194.43, landHigh: 1369.09 },
  { zone: "ZWE", label: "Zimbabwe", year: 2024, avg: 384, avgLow: 326.4, avgHigh: 441.6, marginal: 950, marginalLow: 820, marginalHigh: 1100, fossilShare: 0.429, landCm2PerKwh: 466.43, landLow: 178.17, landHigh: 1068.5 },
];
