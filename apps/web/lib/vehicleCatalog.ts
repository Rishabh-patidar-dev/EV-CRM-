// Real Luxus Green Mobility product photography, mapped to the `model`
// string stored on VehicleUnit / StockTransferRequest. The inventory
// gallery (inventory-management/vehicles/page.tsx) only shows models listed here — any
// other model (test/demo rows, catalog entries with no matching photo)
// stays in the table view below instead of showing a fake placeholder image.
export const VEHICLE_IMAGES: Record<string, string> = {
  "LX Lifter": "/vehicles/lx-lifter.webp",
  "LX Spark": "/vehicles/lx-spark.webp",
  "LX Soorma": "/vehicles/lx-soorma.webp",
  "LX Nirmal": "/vehicles/lx-nirmal.webp",
  "LX Speedo": "/vehicles/lx-speedo.webp",
  "Queen EV": "/vehicles/queen-ev.webp",
  "LX EV Cargo": "/vehicles/lx-ev-cargo.webp",
  "LX DV": "/vehicles/lx-dv.webp",
  "LX Foodcart": "/vehicles/lx-foodcart.webp",
  // DLX / premium trim line (luxusgreen.com/products) — added separately
  // from the base L5/L3 lineup above.
  "Queen EV DLX": "/vehicles/queen-ev-dlx.webp",
  "LX EV DLX": "/vehicles/lx-ev-dlx.webp",
  "LX DV DLX": "/vehicles/lx-dv-dlx.webp",
  "LX TEV DLX": "/vehicles/lx-tev-dlx.webp",
  "Queen Mini DLX": "/vehicles/queen-mini-dlx.webp",
  "LX EV 1.5 S.DLX": "/vehicles/lx-ev-15-sdlx.webp",
  "LX DV Mega": "/vehicles/lx-dv-mega.webp",
  "LX TEV Mega": "/vehicles/lx-tev-mega.webp",
};
