import { prisma } from "@repo/db";

function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick<T>(arr: T[]): T { return arr[randInt(0, arr.length - 1)]; }
function daysAgo(d: number) { return new Date(Date.now() - d * 86_400_000); }
function pad(n: number) { return String(n).padStart(6, "0"); }

const MODELS = [
  { model: "LX Lifter", segment: "L5" as const },
  { model: "LX Spark", segment: "L5" as const },
  { model: "LX Soorma", segment: "L5" as const },
  { model: "LX Nirmal", segment: "L5" as const },
  { model: "Queen EV", segment: "L3" as const },
  { model: "LX EV Cargo", segment: "L3" as const },
  { model: "LX DV", segment: "L3" as const },
  { model: "LX Foodcart", segment: "CUSTOMISED" as const },
];

const SPARE_PARTS = [
  { partName: "Brake Pad Set", partCode: "BRK-001", qty: 120 },
  { partName: "Front Suspension Assembly", partCode: "SUS-002", qty: 35 },
  { partName: "BLDC Hub Motor 6000W", partCode: "MTR-003", qty: 18 },
  { partName: "Lithium-ion Battery Pack 51.2V", partCode: "BAT-004", qty: 22 },
  { partName: "Motor Controller", partCode: "CTL-005", qty: 40 },
  { partName: "Onboard Charger CAN 46A", partCode: "CHG-006", qty: 60 },
  { partName: "Headlight Assembly", partCode: "LGT-007", qty: 90 },
  { partName: "Tail Light Assembly", partCode: "LGT-008", qty: 85 },
  { partName: "Digital Instrument Cluster", partCode: "INS-009", qty: 15 },
  { partName: "Tyre 120x80 R12 Tubeless", partCode: "TYR-010", qty: 200 },
  { partName: "Wiring Harness", partCode: "WIR-011", qty: 55 },
  { partName: "DC-DC Converter", partCode: "DCV-012", qty: 4 },
];

const BUYER_NAMES = ["Ramesh Yadav", "Sunita Sharma", "Arvind Patel", "Priya Nair", "Manoj Singh", "Divya Reddy", "Karan Mehta", "Anita Joshi", "Suresh Kumar", "Neha Gupta", "Vijay Rao", "Pooja Iyer"];
const FIRST_NAMES = ["Rahul", "Ananya", "Vikram", "Kavya", "Sanjay", "Meera", "Deepak", "Ritu", "Nikhil", "Shreya", "Aditya", "Isha", "Rohit", "Tanvi", "Ajay"];
const LAST_NAMES = ["Verma", "Chauhan", "Menon", "Das", "Bhat", "Pillai", "Malhotra", "Kapoor", "Bose", "Trivedi"];
const CITIES = [["Raipur", "Chhattisgarh"], ["Indore", "Madhya Pradesh"], ["Jaipur", "Rajasthan"], ["Delhi", "Delhi"], ["Bengaluru", "Karnataka"], ["Ahmedabad", "Gujarat"], ["Kochi", "Kerala"], ["Ludhiana", "Punjab"]];

async function main() {
  const dealers = await prisma.dealer.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  const dealerIds = dealers.map((d) => d.id);
  console.log(`active dealers: ${dealerIds.length}`);

  // 1. Spare part inventory catalog
  for (const p of SPARE_PARTS) {
    await prisma.sparePartInventory.upsert({
      where: { partName: p.partName },
      update: { quantityOnHand: p.qty, partCode: p.partCode },
      create: { partName: p.partName, partCode: p.partCode, quantityOnHand: p.qty },
    });
  }
  console.log("spare part inventory: done");

  // 2. Vehicle units — OEM warehouse + allocated + sold + misc statuses
  let vin = Date.now() % 10_000_000;
  for (const m of MODELS) {
    const oemStock = randInt(15, 45);
    for (let i = 0; i < oemStock; i++) {
      await prisma.vehicleUnit.create({ data: { vin: `LGM${vin++}`, model: m.model, segment: m.segment, status: "IN_STOCK", manufacturedAt: daysAgo(randInt(10, 200)) } });
    }
    for (let i = 0; i < randInt(6, 14); i++) {
      await prisma.vehicleUnit.create({ data: { vin: `LGM${vin++}`, model: m.model, segment: m.segment, status: "ALLOCATED", dealerId: pick(dealerIds), allocatedAt: daysAgo(randInt(1, 90)), manufacturedAt: daysAgo(randInt(20, 220)) } });
    }
    for (let i = 0; i < randInt(8, 20); i++) {
      const soldAt = daysAgo(randInt(0, 56));
      await prisma.vehicleUnit.create({ data: { vin: `LGM${vin++}`, model: m.model, segment: m.segment, status: "SOLD", dealerId: pick(dealerIds), allocatedAt: daysAgo(randInt(60, 250)), soldAt, buyerName: pick(BUYER_NAMES), invoiceNumber: `INV-VEH-${vin}`, manufacturedAt: daysAgo(randInt(70, 260)) } });
    }
    for (let i = 0; i < randInt(1, 3); i++) {
      await prisma.vehicleUnit.create({ data: { vin: `LGM${vin++}`, model: m.model, segment: m.segment, status: "DEMO", isDemoUnit: true, dealerId: pick(dealerIds), allocatedAt: daysAgo(randInt(5, 60)) } });
    }
    for (let i = 0; i < randInt(2, 6); i++) {
      await prisma.vehicleUnit.create({ data: { vin: `LGM${vin++}`, model: m.model, segment: m.segment, status: "IN_TRANSIT" } });
    }
    if (Math.random() < 0.6) {
      await prisma.vehicleUnit.create({ data: { vin: `LGM${vin++}`, model: m.model, segment: m.segment, status: "SERVICE_HOLD", dealerId: pick(dealerIds), allocatedAt: daysAgo(randInt(10, 80)) } });
    }
  }
  console.log("vehicle units: done");

  // 3. Stock transfer requests (vehicle orders) spread over the last 8 weeks
  const STR_STATUSES = ["DELIVERED", "DELIVERED", "DELIVERED", "APPROVED", "APPROVED", "DISPATCHED", "REQUESTED", "REQUESTED", "REJECTED", "CANCELLED"];
  let strSeq = await prisma.stockTransferRequest.count();
  const createdTransfers: { id: number; dealerId: number; model: string; segment: string; quantity: number; status: string; createdAt: Date }[] = [];
  for (let i = 0; i < 70; i++) {
    const m = pick(MODELS);
    const status = pick(STR_STATUSES);
    strSeq++;
    const createdAt = daysAgo(randInt(0, 56));
    const t = await prisma.stockTransferRequest.create({
      data: {
        requestNumber: `STR-2026-${pad(strSeq)}`, dealerId: pick(dealerIds), model: m.model, segment: m.segment,
        quantity: randInt(1, 8), status: status as any, placedVia: Math.random() < 0.4 ? "DMS" : "STAFF",
        createdAt, updatedAt: createdAt,
        dispatchedAt: ["DISPATCHED", "DELIVERED"].includes(status) ? daysAgo(randInt(0, 40)) : null,
        deliveredAt: status === "DELIVERED" ? daysAgo(randInt(0, 30)) : null,
      },
    });
    createdTransfers.push(t as any);
  }
  console.log("stock transfer requests: done");

  // 4. Spare part requests
  const SPR_STATUSES = ["DELIVERED", "DELIVERED", "APPROVED", "DISPATCHED", "REQUESTED", "REQUESTED", "CANCELLED"];
  let sprSeq = await prisma.sparePartRequest.count();
  for (let i = 0; i < 40; i++) {
    const p = pick(SPARE_PARTS);
    const status = pick(SPR_STATUSES);
    sprSeq++;
    const createdAt = daysAgo(randInt(0, 56));
    await prisma.sparePartRequest.create({
      data: {
        requestNumber: `SPR-2026-${pad(sprSeq)}`, dealerId: pick(dealerIds), partName: p.partName, partCode: p.partCode,
        quantity: randInt(1, 15), status: status as any, placedVia: Math.random() < 0.4 ? "DMS" : "STAFF",
        createdAt, updatedAt: createdAt,
        dispatchedAt: status === "DISPATCHED" || status === "DELIVERED" ? daysAgo(randInt(0, 30)) : null,
      },
    });
  }
  console.log("spare part requests: done");

  // 5. Backfill CONFIRMATION invoices for a sample of approved/dispatched/delivered transfers
  let invSeq = await prisma.invoice.count();
  const confirmable = createdTransfers.filter((t) => ["APPROVED", "DISPATCHED", "DELIVERED"].includes(t.status)).slice(0, 25);
  for (const t of confirmable) {
    invSeq++;
    await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-2026-${pad(invSeq)}`, orderKind: "VEHICLE", stockTransferRequestId: t.id, dealerId: t.dealerId,
        type: "CONFIRMATION", item: `${t.model} (${t.segment})`, requestedQuantity: t.quantity, fulfilledQuantity: t.quantity,
        issuedAt: t.createdAt, createdAt: t.createdAt,
      },
    });
  }
  console.log("confirmation invoices: done");

  // 6. A couple of genuinely disputed orders (requested > live OEM stock) with
  // notices + OUT_OF_STOCK / PARTIAL invoices, so Disputed Orders + Invoices
  // both show real variety, not just confirmations.
  for (const m of [MODELS[0], MODELS[4]]) {
    const available = await prisma.vehicleUnit.count({ where: { dealerId: null, status: "IN_STOCK", model: m.model, segment: m.segment } });
    const qty = available + randInt(5, 15);
    strSeq++;
    const createdAt = daysAgo(randInt(1, 10));
    const order = await prisma.stockTransferRequest.create({
      data: { requestNumber: `STR-2026-${pad(strSeq)}`, dealerId: pick(dealerIds), model: m.model, segment: m.segment, quantity: qty, status: "DISPUTED", placedVia: "DMS", createdAt, updatedAt: createdAt },
    });
    const offered = Math.random() < 0.5 ? available : null;
    const expectedRestockDate = daysAgo(-21);
    const message = offered != null
      ? `We can fulfil ${offered} of ${qty} now; the remainder will follow once new stock arrives.`
      : `Currently out of stock for this model; expected back in ~3 weeks.`;
    await prisma.orderStockNotice.create({
      data: {
        orderKind: "VEHICLE", stockTransferRequestId: order.id, requestedQuantity: qty, availableQuantity: available,
        status: "SENT", offeredQuantity: offered, dealerResponse: "PENDING", expectedRestockDate, message, sentAt: createdAt, createdAt,
      },
    });
    invSeq++;
    await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-2026-${pad(invSeq)}`, orderKind: "VEHICLE", stockTransferRequestId: order.id, dealerId: order.dealerId,
        type: offered != null ? "PARTIAL" : "OUT_OF_STOCK", item: `${m.model} (${m.segment})`, requestedQuantity: qty, fulfilledQuantity: offered ?? 0,
        expectedRestockDate, message, issuedAt: createdAt, createdAt,
      },
    });
  }
  console.log("disputed sample orders + invoices: done");

  // 7. Leads, some assigned to dealers
  let leadCount = 0;
  for (let i = 0; i < 30; i++) {
    const [city, state] = pick(CITIES);
    const status = pick(["OPEN", "WORKING", "QUALIFIED", "NURTURING", "UNQUALIFIED", "CONVERTED"]);
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const createdAt = daysAgo(randInt(0, 60));
    const lead = await prisma.lead.create({
      data: {
        firstName: first, lastName: last, email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
        phone: `9${randInt(100000000, 999999999)}`, city, state, source: pick(["LANDING_PAGE", "MANUAL", "IMPORT"]) as any,
        status: status as any, createdAt, updatedAt: createdAt,
      },
    });
    leadCount++;
    if (Math.random() < 0.7) {
      await prisma.dealerLeadAssignment.create({
        data: { leadId: lead.id, dealerId: pick(dealerIds), status: pick(["ASSIGNED", "ACCEPTED", "CONTACTED", "CONVERTED", "LOST"]) as any, routedBy: "AUTO_TERRITORY", assignedAt: createdAt },
      }).catch(() => {});
    }
  }
  console.log(`leads: done (${leadCount})`);

  console.log("BULK SEED COMPLETE");
}

main().finally(() => prisma.$disconnect());
