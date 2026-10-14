'use strict';
// These IDs describe appearance only; collision and alpha masks use the original descriptors.
function detailStyle(name) {
  if(/^dust_windows_01$/.test(name))return 1;
  if(/^dust_windows_low$/.test(name))return 2;
  if(/^dust_kasbah_windows_01$/.test(name))return 3;
  if(/window_bars|awning_fabric_frame/.test(name))return 4;
  if(/window_frame_(plaster|stone)|kasbah_window_insets/.test(name))return 5;
  if(/window_frame_wood/.test(name))return 6;
  if(/awning_fabric(?!_frame)|tarp|tarpaulin/.test(name))return 7;
  return 0;
}
module.exports={detailStyle};
