// Local-dev seed data for EV Vikas. Resets and repopulates every table so
// `npm run db:seed` is safe to re-run. Not meant to model a real dealer
// network — just enough breadth to click through every module, including
// enough warranty/workshop/ledger history to see the closed loop.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}
function monthsFromNow(months: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d;
}

function complianceStatus(expiresAt: Date | null): "VALID" | "EXPIRING_SOON" | "EXPIRED" | "MISSING" {
  if (!expiresAt) return "MISSING";
  const days = Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "EXPIRED";
  if (days <= 30) return "EXPIRING_SOON";
  return "VALID";
}

// Mirrors apps/api/src/services/leadScoring.service.ts (completeness x0.7 +
// quality x0.3 across 7 fields) — duplicated in a handful of lines here
// rather than importing across the packages/db <-> apps/api boundary.
function scoreLead(l: { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null; companyName?: string | null; city?: string | null; state?: string | null; pincode?: string | null }) {
  const fields = {
    name: [l.firstName, l.lastName].filter(Boolean).join(" "),
    email: l.email ?? "",
    phone: l.phone ?? "",
    companyName: l.companyName ?? "",
    city: l.city ?? "",
    state: l.state ?? "",
    pincode: l.pincode ?? "",
  };
  let completenessScore = 0;
  const missingFields: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v && v.trim() !== "") completenessScore += 14.3;
    else missingFields.push(k);
  }
  const qualityScore = 100; // seed data is always well-formed
  const totalScore = Math.round(completenessScore * 0.7 + qualityScore * 0.3);
  return { score: totalScore, completenessScore: Math.round(completenessScore), qualityScore, missingFields, invalidFields: [] as string[] };
}

async function main() {
  console.log("Resetting local dev data…");
  // Delete in FK-dependency order (children before parents).
  await prisma.supplierRecovery.deleteMany();
  await prisma.warrantyClaimEvent.deleteMany();
  await prisma.warrantyClaim.deleteMany();
  await prisma.componentUnit.deleteMany();
  await prisma.warrantyPlan.deleteMany();
  await prisma.leadRemark.deleteMany();
  await prisma.dealerComplianceRecord.deleteMany();
  await prisma.vehiclePurchaseOrder.deleteMany();
  await prisma.stockTransferRequest.deleteMany();
  await prisma.vehicleUnit.deleteMany();
  await prisma.sparePartRequest.deleteMany();
  await prisma.serviceTicket.deleteMany();
  await prisma.financeCase.deleteMany();
  await prisma.dealerLeadAssignment.deleteMany();
  await prisma.dealerPerformanceSnapshot.deleteMany();
  await prisma.dealerTarget.deleteMany();
  await prisma.dealerTerritory.deleteMany();
  await prisma.dealer.deleteMany();
  await prisma.onboardingStageEvent.deleteMany();
  await prisma.dealerApplicationDocument.deleteMany();
  await prisma.dealerApplication.deleteMany();
  await prisma.formSubmission.deleteMany();
  await prisma.enquiry.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.landingPageCampaign.deleteMany();
  await prisma.user.deleteMany();

  console.log("Seeding users…");
  const admin = await prisma.user.create({
    data: { firstName: "Priya", lastName: "Sharma", email: "admin@evvikas.in", role: "SYSTEM_ADMIN" },
  });
  const rohit = await prisma.user.create({
    data: { firstName: "Rohit", lastName: "Verma", email: "rohit@evvikas.in", role: "RELATIONSHIP_MANAGER" },
  });
  const ananya = await prisma.user.create({
    data: { firstName: "Ananya", lastName: "Iyer", email: "ananya@evvikas.in", role: "RELATIONSHIP_MANAGER" },
  });
  const karan = await prisma.user.create({
    data: { firstName: "Karan", lastName: "Mehta", email: "karan@evvikas.in", role: "NETWORK_EXPANSION" },
  });

  console.log("Seeding landing-page campaigns…");
  const campaign = await prisma.landingPageCampaign.create({
    data: {
      uniqueId: "google-dealer-q1-2026",
      name: "Dealer Expansion — Q1 2026 Google Ads",
      description: "Google Search + Display, targeting prospective EV dealers in tier-2 cities.",
      status: "ACTIVE",
      gtmContainerId: "GTM-EVVIKAS1",
      createdBy: admin.id,
    },
  });
  const retailCampaign = await prisma.landingPageCampaign.create({
    data: {
      uniqueId: "meta-retail-launch-2026",
      name: "Retail Launch — Meta Ads",
      description: "Facebook/Instagram campaign driving vehicle enquiries to the retail landing page.",
      status: "ACTIVE",
      gtmContainerId: "GTM-EVVIKAS2",
      createdBy: admin.id,
    },
  });

  console.log("Seeding dealers…");
  const periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const dealerSeeds = [
    {
      dealerCode: "EVV-CG-001",
      legalName: "Bilaspur EV Hub Pvt Ltd",
      tradeName: "Bilaspur EV Hub",
      principalName: "Suresh Patel",
      phone: "9876500001",
      email: "suresh@bilaspurevhub.in",
      city: "Bilaspur",
      state: "Chhattisgarh",
      pincode: "495001",
      tier: "FLAGSHIP" as const,
      segments: "L5,L3,CUSTOMISED",
      rmId: rohit.id,
      creditLimit: 2500000,
      securityDeposit: 500000,
      target: { unitTarget: 25, revenueTarget: 18750000 },
      actual: { unitsSold: 19, revenue: 14250000, leadsReceived: 40, leadsConverted: 19 },
    },
    {
      dealerCode: "EVV-MP-001",
      legalName: "Indore Green Motors LLP",
      tradeName: "Indore Green Motors",
      principalName: "Deepak Joshi",
      phone: "9876500002",
      email: "deepak@indoregreenmotors.in",
      city: "Indore",
      state: "Madhya Pradesh",
      pincode: "452001",
      tier: "PREMIUM" as const,
      segments: "L5,L3",
      rmId: ananya.id,
      creditLimit: 1500000,
      securityDeposit: 300000,
      target: { unitTarget: 18, revenueTarget: 12600000 },
      actual: { unitsSold: 9, revenue: 6300000, leadsReceived: 28, leadsConverted: 9 },
    },
    {
      dealerCode: "EVV-RJ-001",
      legalName: "Jaipur EV Point Pvt Ltd",
      tradeName: "Jaipur EV Point",
      principalName: "Meena Rathore",
      phone: "9876500003",
      email: "meena@jaipurevpoint.in",
      city: "Jaipur",
      state: "Rajasthan",
      pincode: "302001",
      tier: "STANDARD" as const,
      segments: "L3",
      rmId: rohit.id,
      creditLimit: 800000,
      securityDeposit: 150000,
      target: { unitTarget: 10, revenueTarget: 5000000 },
      actual: { unitsSold: 11, revenue: 5500000, leadsReceived: 15, leadsConverted: 11 },
    },
    {
      dealerCode: "EVV-DL-001",
      legalName: "Delhi Central Mobility Pvt Ltd",
      tradeName: "Delhi Central Mobility",
      principalName: "Arjun Kapoor",
      phone: "9876500004",
      email: "arjun@delhicentralmobility.in",
      city: "New Delhi",
      state: "Delhi",
      pincode: "110001",
      tier: "FLAGSHIP" as const,
      segments: "L5,L3,CUSTOMISED",
      rmId: ananya.id,
      creditLimit: 3000000,
      securityDeposit: 600000,
      target: { unitTarget: 30, revenueTarget: 22500000 },
      actual: { unitsSold: 12, revenue: 9000000, leadsReceived: 45, leadsConverted: 12 },
    },
    {
      dealerCode: "EVV-KA-001",
      legalName: "Bengaluru EV Circuit Pvt Ltd",
      tradeName: "Bengaluru EV Circuit",
      principalName: "Nikhil Rao",
      phone: "9876500006",
      email: "nikhil@bengalureveircuit.in",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
      tier: "FLAGSHIP" as const,
      segments: "L5,L3,CUSTOMISED",
      rmId: rohit.id,
      creditLimit: 2800000,
      securityDeposit: 550000,
      target: { unitTarget: 28, revenueTarget: 21000000 },
      actual: { unitsSold: 21, revenue: 15750000, leadsReceived: 38, leadsConverted: 21 },
    },
    {
      dealerCode: "EVV-GJ-001",
      legalName: "Ahmedabad Volt Traders Pvt Ltd",
      tradeName: "Ahmedabad Volt Traders",
      principalName: "Bhavesh Patel",
      phone: "9876500007",
      email: "bhavesh@ahmedabadvolttraders.in",
      city: "Ahmedabad",
      state: "Gujarat",
      pincode: "380001",
      tier: "PREMIUM" as const,
      segments: "L5,L3",
      rmId: ananya.id,
      creditLimit: 1800000,
      securityDeposit: 350000,
      target: { unitTarget: 20, revenueTarget: 14000000 },
      actual: { unitsSold: 14, revenue: 9800000, leadsReceived: 26, leadsConverted: 14 },
    },
    {
      dealerCode: "EVV-KL-001",
      legalName: "Kochi Coastal EV Pvt Ltd",
      tradeName: "Kochi Coastal EV",
      principalName: "Anoop Menon",
      phone: "9876500008",
      email: "anoop@kochicoastalev.in",
      city: "Kochi",
      state: "Kerala",
      pincode: "682001",
      tier: "STANDARD" as const,
      segments: "L3",
      rmId: rohit.id,
      creditLimit: 900000,
      securityDeposit: 180000,
      target: { unitTarget: 12, revenueTarget: 6000000 },
      actual: { unitsSold: 6, revenue: 3000000, leadsReceived: 17, leadsConverted: 6 },
    },
    {
      dealerCode: "EVV-PB-001",
      legalName: "Ludhiana Spark Motors Pvt Ltd",
      tradeName: "Ludhiana Spark Motors",
      principalName: "Harpreet Singh",
      phone: "9876500009",
      email: "harpreet@ludhianasparkmotors.in",
      city: "Ludhiana",
      state: "Punjab",
      pincode: "141001",
      tier: "PREMIUM" as const,
      segments: "L5,L3",
      rmId: ananya.id,
      creditLimit: 1600000,
      securityDeposit: 320000,
      target: { unitTarget: 16, revenueTarget: 11200000 },
      actual: { unitsSold: 17, revenue: 11900000, leadsReceived: 22, leadsConverted: 17 },
    },
  ];

  const dealers: Record<string, Awaited<ReturnType<typeof prisma.dealer.create>>> = {};
  for (const s of dealerSeeds) {
    const dealer = await prisma.dealer.create({
      data: {
        dealerCode: s.dealerCode,
        legalName: s.legalName,
        tradeName: s.tradeName,
        principalName: s.principalName,
        phone: s.phone,
        email: s.email,
        city: s.city,
        state: s.state,
        pincode: s.pincode,
        tier: s.tier,
        status: "ACTIVE",
        segments: s.segments,
        relationshipManagerId: s.rmId,
        creditLimit: s.creditLimit,
        securityDeposit: s.securityDeposit,
        appointedAt: daysFromNow(-240),
        goLiveAt: daysFromNow(-210),
      },
    });
    dealers[s.dealerCode] = dealer;

    await prisma.dealerTerritory.create({
      data: { dealerId: dealer.id, state: s.state, district: s.city, exclusive: true },
    });
    await prisma.dealerTerritory.create({
      data: { dealerId: dealer.id, state: s.state, district: null, exclusive: false },
    });
    await prisma.dealerTarget.create({
      data: {
        dealerId: dealer.id,
        periodType: "MONTHLY",
        periodStart,
        unitTarget: s.target.unitTarget,
        revenueTarget: s.target.revenueTarget,
      },
    });
    await prisma.dealerPerformanceSnapshot.create({
      data: {
        dealerId: dealer.id,
        periodType: "MONTHLY",
        periodStart,
        unitsSold: s.actual.unitsSold,
        revenue: s.actual.revenue,
        leadsReceived: s.actual.leadsReceived,
        leadsConverted: s.actual.leadsConverted,
      },
    });
  }

  // A fifth dealer still in onboarding — no territory/targets yet.
  const patna = await prisma.dealer.create({
    data: {
      dealerCode: "EVV-BR-001",
      legalName: "Patna Electric Wheels Pvt Ltd",
      tradeName: "Patna Electric Wheels",
      principalName: "Vikram Singh",
      phone: "9876500005",
      email: "vikram@patnaelectricwheels.in",
      city: "Patna",
      state: "Bihar",
      pincode: "800001",
      tier: "STANDARD",
      status: "ONBOARDING",
      segments: "L3",
    },
  });
  dealers["EVV-BR-001"] = patna;

  console.log("Seeding dealer onboarding applications…");
  await prisma.dealerApplication.create({
    data: {
      intent: "DEALERSHIP_APPLICATION",
      legalName: "Nagpur EV Ventures",
      contactName: "Sanjay Deshmukh",
      email: "sanjay@nagpurevventures.in",
      phone: "9876511001",
      city: "Nagpur",
      state: "Maharashtra",
      pincode: "440001",
      investmentCapacity: "50L-1Cr",
      stage: "APPLICATION",
      status: "IN_PROGRESS",
      assignedToId: karan.id,
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "dealer-expansion-q1",
      landingPageCampaignId: campaign.id,
      documents: {
        create: [
          { stage: "APPLICATION", docKey: "IDENTITY_PROOF", label: "Identity proof of all stakeholders", status: "UPLOADED" },
          { stage: "APPLICATION", docKey: "PAN_INDIVIDUAL", label: "Individual PAN cards", status: "PENDING" },
          { stage: "APPLICATION", docKey: "GSTIN_CERTIFICATE", label: "GST registration certificate", status: "PENDING" },
          { stage: "APPLICATION", docKey: "PROMOTER_PROFILE", label: "Professional profile of primary investor", status: "PENDING" },
        ],
      },
      stageHistory: {
        create: [{ fromStage: null, toStage: "APPLICATION", note: "Application received via landing page", actorId: karan.id }],
      },
    },
  });

  const midStageApp = await prisma.dealerApplication.create({
    data: {
      intent: "DEALERSHIP_APPLICATION",
      legalName: "Lucknow Volt Motors",
      contactName: "Ritu Agarwal",
      email: "ritu@lucknowvoltmotors.in",
      phone: "9876511002",
      city: "Lucknow",
      state: "Uttar Pradesh",
      pincode: "226001",
      investmentCapacity: "1Cr-2Cr",
      tier: "FLAGSHIP_3S",
      stage: "DUE_DILIGENCE",
      status: "IN_PROGRESS",
      assignedToId: karan.id,
      utmSource: "facebook",
      utmMedium: "social",
      utmCampaign: "dealer-expansion-q1",
      landingPageCampaignId: campaign.id,
      documents: {
        create: [
          { stage: "APPLICATION", docKey: "IDENTITY_PROOF", label: "Identity proof of all stakeholders", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-30) },
          { stage: "APPLICATION", docKey: "PAN_INDIVIDUAL", label: "Individual PAN cards", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-30) },
          { stage: "APPLICATION", docKey: "GSTIN_CERTIFICATE", label: "GST registration certificate", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-29) },
          { stage: "SCREENING_NDA", docKey: "SIGNED_NDA", label: "Signed NDA", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-20) },
          { stage: "SCREENING_NDA", docKey: "CIBIL_REPORTS", label: "CIBIL score reports", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-20) },
          { stage: "BUSINESS_PROPOSAL", docKey: "DPR", label: "Detailed Project Report", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-10) },
          { stage: "DUE_DILIGENCE", docKey: "AUDITED_FINANCIALS_3Y", label: "Audited financials (3 FY)", status: "UPLOADED" },
          { stage: "DUE_DILIGENCE", docKey: "FIRE_NOC", label: "Fire Department NOC", status: "PENDING" },
          { stage: "DUE_DILIGENCE", docKey: "SITE_MEDIA", label: "Geo-tagged site photos/video", status: "PENDING" },
        ],
      },
      stageHistory: {
        create: [
          { fromStage: null, toStage: "APPLICATION", note: "Application received via landing page", actorId: karan.id, createdAt: daysFromNow(-35) },
          { fromStage: "APPLICATION", toStage: "SCREENING_NDA", note: "Docs verified", actorId: admin.id, createdAt: daysFromNow(-28) },
          { fromStage: "SCREENING_NDA", toStage: "BUSINESS_PROPOSAL", note: "NDA + CIBIL cleared", actorId: admin.id, createdAt: daysFromNow(-18) },
          { fromStage: "BUSINESS_PROPOSAL", toStage: "DUE_DILIGENCE", note: "DPR approved", actorId: admin.id, createdAt: daysFromNow(-8) },
        ],
      },
    },
  });
  void midStageApp;

  const legalStageApp = await prisma.dealerApplication.create({
    data: {
      intent: "DEALERSHIP_APPLICATION",
      legalName: "Chandigarh Electric Fleet Pvt Ltd",
      contactName: "Simran Bawa",
      email: "simran@chandigarhelectricfleet.in",
      phone: "9876511003",
      city: "Chandigarh",
      state: "Chandigarh",
      pincode: "160001",
      investmentCapacity: "1Cr-2Cr",
      tier: "MINI_SHOWROOM",
      stage: "LEGAL_AGREEMENT",
      status: "IN_PROGRESS",
      assignedToId: karan.id,
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "dealer-expansion-q1",
      landingPageCampaignId: campaign.id,
      documents: {
        create: [
          { stage: "APPLICATION", docKey: "IDENTITY_PROOF", label: "Identity proof of all stakeholders", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-60) },
          { stage: "SCREENING_NDA", docKey: "SIGNED_NDA", label: "Signed NDA", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-50) },
          { stage: "BUSINESS_PROPOSAL", docKey: "DPR", label: "Detailed Project Report", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-35) },
          { stage: "DUE_DILIGENCE", docKey: "AUDITED_FINANCIALS_3Y", label: "Audited financials (3 FY)", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-15) },
          { stage: "LEGAL_AGREEMENT", docKey: "LOI_SIGNED", label: "Letter of Intent (LOI) issued to applicant", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-5) },
          { stage: "LEGAL_AGREEMENT", docKey: "DEALER_AGREEMENT", label: "E-signed dealer agreement", status: "UPLOADED" },
          { stage: "LEGAL_AGREEMENT", docKey: "SECURITY_DEPOSIT", label: "Security deposit proof", status: "PENDING" },
        ],
      },
      stageHistory: {
        create: [
          { fromStage: null, toStage: "APPLICATION", note: "Application received via landing page", actorId: karan.id, createdAt: daysFromNow(-65) },
          { fromStage: "APPLICATION", toStage: "SCREENING_NDA", note: "Docs verified", actorId: admin.id, createdAt: daysFromNow(-55) },
          { fromStage: "SCREENING_NDA", toStage: "BUSINESS_PROPOSAL", note: "NDA cleared", actorId: admin.id, createdAt: daysFromNow(-40) },
          { fromStage: "BUSINESS_PROPOSAL", toStage: "DUE_DILIGENCE", note: "DPR approved", actorId: admin.id, createdAt: daysFromNow(-20) },
          { fromStage: "DUE_DILIGENCE", toStage: "LEGAL_AGREEMENT", note: "Financials cleared", actorId: admin.id, createdAt: daysFromNow(-6) },
        ],
      },
    },
  });
  void legalStageApp;

  // A fully completed application — reached OPERATIONAL, the terminal stage
  // after the LOI (stage 5) and dealer agreement are done.
  const operationalApp = await prisma.dealerApplication.create({
    data: {
      intent: "DEALERSHIP_APPLICATION",
      legalName: "Surat Fleet Motors Pvt Ltd",
      contactName: "Yusuf Khan",
      email: "yusuf.fleet@example.com",
      phone: "9812345686",
      city: "Surat",
      state: "Gujarat",
      pincode: "395001",
      investmentCapacity: "50L-1Cr",
      tier: "FLAGSHIP_3S",
      stage: "OPERATIONAL",
      status: "APPROVED",
      assignedToId: karan.id,
      utmSource: "manual",
      utmMedium: "referral",
      documents: {
        create: [
          { stage: "LEGAL_AGREEMENT", docKey: "LOI_SIGNED", label: "Letter of Intent (LOI) issued to applicant", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-14) },
          { stage: "LEGAL_AGREEMENT", docKey: "DEALER_AGREEMENT", label: "Franchise/Dealership agreement (Aadhaar e-sign, e-stamped)", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-12) },
          { stage: "LEGAL_AGREEMENT", docKey: "SECURITY_DEPOSIT_PROOF", label: "Security deposit proof (RTGS/NEFT ref or Bank Guarantee)", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-11) },
        ],
      },
      stageHistory: {
        create: [
          { fromStage: null, toStage: "APPLICATION", note: "Walk-in referral, converted from a retail lead", actorId: karan.id, createdAt: daysFromNow(-80) },
          { fromStage: "APPLICATION", toStage: "SCREENING_NDA", note: "Docs verified", actorId: admin.id, createdAt: daysFromNow(-60) },
          { fromStage: "SCREENING_NDA", toStage: "BUSINESS_PROPOSAL", note: "NDA cleared", actorId: admin.id, createdAt: daysFromNow(-45) },
          { fromStage: "BUSINESS_PROPOSAL", toStage: "DUE_DILIGENCE", note: "DPR approved", actorId: admin.id, createdAt: daysFromNow(-25) },
          { fromStage: "DUE_DILIGENCE", toStage: "LEGAL_AGREEMENT", note: "Financials cleared, LOI issued", actorId: admin.id, createdAt: daysFromNow(-14) },
          { fromStage: "LEGAL_AGREEMENT", toStage: "OPERATIONAL", note: "Agreement signed, deposit received — appointed as a live dealer", actorId: admin.id, createdAt: daysFromNow(-10) },
        ],
      },
    },
  });
  void operationalApp;

  const screeningApp = await prisma.dealerApplication.create({
    data: {
      intent: "DEALERSHIP_APPLICATION",
      legalName: "Bhubaneswar EV Hub",
      contactName: "Debasish Patra",
      email: "debasish@bhubaneswarevhub.in",
      phone: "9876511004",
      city: "Bhubaneswar",
      state: "Odisha",
      pincode: "751001",
      investmentCapacity: "50L-1Cr",
      stage: "SCREENING_NDA",
      status: "IN_PROGRESS",
      assignedToId: rohit.id,
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "dealer-expansion-q1",
      landingPageCampaignId: campaign.id,
      documents: {
        create: [
          { stage: "APPLICATION", docKey: "IDENTITY_PROOF", label: "Identity proof of all stakeholders", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-12) },
          { stage: "APPLICATION", docKey: "PAN_INDIVIDUAL", label: "Individual PAN cards", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-12) },
          { stage: "APPLICATION", docKey: "GSTIN_CERTIFICATE", label: "GST registration certificate", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-11) },
          { stage: "SCREENING_NDA", docKey: "SIGNED_NDA", label: "Signed NDA", status: "UPLOADED" },
          { stage: "SCREENING_NDA", docKey: "EOI_FORM", label: "Expression of Interest form", status: "PENDING" },
          { stage: "SCREENING_NDA", docKey: "CIBIL_REPORTS", label: "CIBIL score reports", status: "PENDING" },
        ],
      },
      stageHistory: {
        create: [
          { fromStage: null, toStage: "APPLICATION", note: "Application received via landing page", actorId: rohit.id, createdAt: daysFromNow(-14) },
          { fromStage: "APPLICATION", toStage: "SCREENING_NDA", note: "Docs verified", actorId: admin.id, createdAt: daysFromNow(-10) },
        ],
      },
    },
  });
  void screeningApp;

  const proposalApp = await prisma.dealerApplication.create({
    data: {
      intent: "DEALERSHIP_APPLICATION",
      legalName: "Guwahati Green Wheels Pvt Ltd",
      contactName: "Bornali Kalita",
      email: "bornali@guwahatigreenwheels.in",
      phone: "9876511005",
      city: "Guwahati",
      state: "Assam",
      pincode: "781001",
      investmentCapacity: "1Cr-2Cr",
      tier: "MINI_SHOWROOM",
      stage: "BUSINESS_PROPOSAL",
      status: "IN_PROGRESS",
      assignedToId: ananya.id,
      utmSource: "facebook",
      utmMedium: "social",
      utmCampaign: "dealer-expansion-q1",
      landingPageCampaignId: campaign.id,
      documents: {
        create: [
          { stage: "APPLICATION", docKey: "IDENTITY_PROOF", label: "Identity proof of all stakeholders", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-40) },
          { stage: "APPLICATION", docKey: "PAN_INDIVIDUAL", label: "Individual PAN cards", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-40) },
          { stage: "APPLICATION", docKey: "GSTIN_CERTIFICATE", label: "GST registration certificate", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-39) },
          { stage: "SCREENING_NDA", docKey: "SIGNED_NDA", label: "Signed NDA", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-25) },
          { stage: "SCREENING_NDA", docKey: "EOI_FORM", label: "Expression of Interest form", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-25) },
          { stage: "SCREENING_NDA", docKey: "CIBIL_REPORTS", label: "CIBIL score reports", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-24) },
          { stage: "BUSINESS_PROPOSAL", docKey: "DPR", label: "Detailed Project Report", status: "UPLOADED" },
          { stage: "BUSINESS_PROPOSAL", docKey: "FIN_PROJECTIONS_3Y", label: "3-year financial projections", status: "PENDING" },
          { stage: "BUSINESS_PROPOSAL", docKey: "FUNDING_PROOF", label: "Funding source declaration", status: "PENDING" },
        ],
      },
      stageHistory: {
        create: [
          { fromStage: null, toStage: "APPLICATION", note: "Application received via landing page", actorId: ananya.id, createdAt: daysFromNow(-42) },
          { fromStage: "APPLICATION", toStage: "SCREENING_NDA", note: "Docs verified", actorId: admin.id, createdAt: daysFromNow(-38) },
          { fromStage: "SCREENING_NDA", toStage: "BUSINESS_PROPOSAL", note: "NDA + CIBIL cleared", actorId: admin.id, createdAt: daysFromNow(-23) },
        ],
      },
    },
  });
  void proposalApp;

  const onHoldApp = await prisma.dealerApplication.create({
    data: {
      intent: "DEALERSHIP_APPLICATION",
      legalName: "Amritsar Motion Mobility",
      contactName: "Harpreet Sandhu",
      email: "harpreet@amritsarmotion.in",
      phone: "9876511006",
      city: "Amritsar",
      state: "Punjab",
      pincode: "143001",
      investmentCapacity: "<50L",
      stage: "APPLICATION",
      status: "ON_HOLD",
      assignedToId: karan.id,
      utmSource: "organic",
      utmMedium: "seo",
      documents: {
        create: [
          { stage: "APPLICATION", docKey: "IDENTITY_PROOF", label: "Identity proof of all stakeholders", status: "UPLOADED" },
          { stage: "APPLICATION", docKey: "PAN_INDIVIDUAL", label: "Individual PAN cards", status: "PENDING" },
          { stage: "APPLICATION", docKey: "GSTIN_CERTIFICATE", label: "GST registration certificate", status: "PENDING" },
          { stage: "APPLICATION", docKey: "PROMOTER_PROFILE", label: "Professional profile of primary investor", status: "PENDING" },
        ],
      },
      stageHistory: {
        create: [
          { fromStage: null, toStage: "APPLICATION", note: "Application received via organic search; placed on hold pending updated PAN documents from promoter", actorId: karan.id, createdAt: daysFromNow(-9) },
        ],
      },
    },
  });
  void onHoldApp;

  const rejectedApp = await prisma.dealerApplication.create({
    data: {
      intent: "DEALERSHIP_APPLICATION",
      legalName: "Coimbatore EV Circuit",
      contactName: "Muthu Selvam",
      email: "muthu@coimbatoreevcircuit.in",
      phone: "9876511007",
      city: "Coimbatore",
      state: "Tamil Nadu",
      pincode: "641001",
      investmentCapacity: "50L-1Cr",
      stage: "DUE_DILIGENCE",
      status: "REJECTED",
      assignedToId: rohit.id,
      utmSource: "google",
      utmMedium: "cpc",
      documents: {
        create: [
          { stage: "APPLICATION", docKey: "IDENTITY_PROOF", label: "Identity proof of all stakeholders", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-55) },
          { stage: "APPLICATION", docKey: "PAN_INDIVIDUAL", label: "Individual PAN cards", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-55) },
          { stage: "APPLICATION", docKey: "GSTIN_CERTIFICATE", label: "GST registration certificate", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-54) },
          { stage: "SCREENING_NDA", docKey: "SIGNED_NDA", label: "Signed NDA", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-45) },
          { stage: "SCREENING_NDA", docKey: "CIBIL_REPORTS", label: "CIBIL score reports", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-45) },
          { stage: "BUSINESS_PROPOSAL", docKey: "DPR", label: "Detailed Project Report", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-30) },
          { stage: "DUE_DILIGENCE", docKey: "AUDITED_FINANCIALS_3Y", label: "Audited financials (3 FY)", status: "REJECTED", notes: "Undisclosed liabilities found on cross-check with bank statements" },
          { stage: "DUE_DILIGENCE", docKey: "BANK_NOC", label: "Bank NOC / No-Dues certificate", status: "REJECTED" },
        ],
      },
      stageHistory: {
        create: [
          { fromStage: null, toStage: "APPLICATION", note: "Application received via landing page", actorId: rohit.id, createdAt: daysFromNow(-58) },
          { fromStage: "APPLICATION", toStage: "SCREENING_NDA", note: "Docs verified", actorId: admin.id, createdAt: daysFromNow(-52) },
          { fromStage: "SCREENING_NDA", toStage: "BUSINESS_PROPOSAL", note: "NDA + CIBIL cleared", actorId: admin.id, createdAt: daysFromNow(-32) },
          { fromStage: "BUSINESS_PROPOSAL", toStage: "DUE_DILIGENCE", note: "DPR approved", actorId: admin.id, createdAt: daysFromNow(-18) },
        ],
      },
    },
  });
  void rejectedApp;

  const withdrawnApp = await prisma.dealerApplication.create({
    data: {
      intent: "DEALERSHIP_APPLICATION",
      legalName: "Vizag Volt Traders",
      contactName: "Lakshmi Prasad",
      email: "lakshmi@vizagvolttraders.in",
      phone: "9876511008",
      city: "Visakhapatnam",
      state: "Andhra Pradesh",
      pincode: "530001",
      investmentCapacity: "<50L",
      stage: "SCREENING_NDA",
      status: "WITHDRAWN",
      assignedToId: ananya.id,
      utmSource: "instagram",
      utmMedium: "social",
      documents: {
        create: [
          { stage: "APPLICATION", docKey: "IDENTITY_PROOF", label: "Identity proof of all stakeholders", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-20) },
          { stage: "APPLICATION", docKey: "PAN_INDIVIDUAL", label: "Individual PAN cards", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-20) },
          { stage: "APPLICATION", docKey: "GSTIN_CERTIFICATE", label: "GST registration certificate", status: "VERIFIED", verifiedById: admin.id, verifiedAt: daysFromNow(-19) },
          { stage: "SCREENING_NDA", docKey: "SIGNED_NDA", label: "Signed NDA", status: "PENDING" },
          { stage: "SCREENING_NDA", docKey: "EOI_FORM", label: "Expression of Interest form", status: "PENDING" },
          { stage: "SCREENING_NDA", docKey: "CIBIL_REPORTS", label: "CIBIL score reports", status: "PENDING" },
        ],
      },
      stageHistory: {
        create: [
          { fromStage: null, toStage: "APPLICATION", note: "Application received via Instagram ad", actorId: ananya.id, createdAt: daysFromNow(-22) },
          { fromStage: "APPLICATION", toStage: "SCREENING_NDA", note: "Docs verified; applicant withdrew shortly after citing funding constraints", actorId: admin.id, createdAt: daysFromNow(-16) },
        ],
      },
    },
  });
  void withdrawnApp;

  console.log("Seeding leads, enquiries, and dealer routing…");
  const leadSeeds = [
    { firstName: "Anita", lastName: "Rao", email: "anita.rao@example.com", phone: "9812345678", companyName: null, city: "Bilaspur", state: "Chhattisgarh", pincode: "495001", source: "LANDING_PAGE" as const, status: "QUALIFIED" as const, ownerId: rohit.id, dealerCode: "EVV-CG-001" },
    { firstName: "Vikas", lastName: "Kumar", email: "vikas.kumar@example.com", phone: "9812345679", companyName: null, city: "Indore", state: "Madhya Pradesh", pincode: "452001", source: "LANDING_PAGE" as const, status: "CONVERTED" as const, ownerId: ananya.id, dealerCode: "EVV-MP-001" },
    { firstName: "Farah", lastName: "Sheikh", email: "farah.sheikh@example.com", phone: "9812345680", companyName: null, city: "Jaipur", state: "Rajasthan", pincode: null, source: "LANDING_PAGE" as const, status: "CONVERTED" as const, ownerId: rohit.id, dealerCode: "EVV-RJ-001" },
    { firstName: "Rahul", lastName: "Gupta", email: "rahul.gupta@example.com", phone: "9812345681", companyName: null, city: "New Delhi", state: "Delhi", pincode: "110001", source: "LANDING_PAGE" as const, status: "WORKING" as const, ownerId: ananya.id, dealerCode: "EVV-DL-001" },
    { firstName: "Sneha", lastName: "Nair", email: "sneha.nair@example.com", phone: "9812345682", companyName: null, city: "Patna", state: "Bihar", pincode: null, source: "LANDING_PAGE" as const, status: "OPEN" as const, ownerId: null, dealerCode: null },
    { firstName: "Manoj", lastName: "Tiwari", email: "manoj.tiwari@example.com", phone: "9812345683", companyName: null, city: "Raipur", state: "Chhattisgarh", pincode: null, source: "LANDING_PAGE" as const, status: "OPEN" as const, ownerId: null, dealerCode: "EVV-CG-001" },
    { firstName: "Deepika", lastName: "Menon", email: "deepika.menon@example.com", phone: "9812345684", companyName: "Menon Logistics", city: "Kochi", state: "Kerala", pincode: "682001", source: "MANUAL" as const, status: "NURTURING" as const, ownerId: rohit.id, dealerCode: null },
    { firstName: "Aslam", lastName: "Sheikh", email: "aslam.sheikh@example.com", phone: "9812345685", companyName: null, city: "Nashik", state: "Maharashtra", pincode: null, source: "IMPORT" as const, status: "UNQUALIFIED" as const, ownerId: null, dealerCode: null },
    { firstName: "Yusuf", lastName: "Khan", email: "yusuf.khan@example.com", phone: "9812345686", companyName: "Khan Fleet Services", city: "Surat", state: "Gujarat", pincode: "395001", source: "MANUAL" as const, status: "OPEN" as const, ownerId: null, dealerCode: null },
    { firstName: "Karthik", lastName: "Iyer", email: "karthik.iyer@example.com", phone: "9812345687", companyName: null, city: "Bengaluru", state: "Karnataka", pincode: "560001", source: "LANDING_PAGE" as const, status: "QUALIFIED" as const, ownerId: rohit.id, dealerCode: "EVV-KA-001" },
    { firstName: "Divya", lastName: "Shetty", email: "divya.shetty@example.com", phone: "9812345688", companyName: null, city: "Mysuru", state: "Karnataka", pincode: null, source: "LANDING_PAGE" as const, status: "WORKING" as const, ownerId: rohit.id, dealerCode: "EVV-KA-001" },
    { firstName: "Rajiv", lastName: "Solanki", email: "rajiv.solanki@example.com", phone: "9812345689", companyName: "Solanki Transport", city: "Ahmedabad", state: "Gujarat", pincode: "380001", source: "LANDING_PAGE" as const, status: "CONVERTED" as const, ownerId: ananya.id, dealerCode: "EVV-GJ-001" },
    { firstName: "Meera", lastName: "Pillai", email: "meera.pillai@example.com", phone: "9812345690", companyName: null, city: "Kochi", state: "Kerala", pincode: "682001", source: "LANDING_PAGE" as const, status: "OPEN" as const, ownerId: null, dealerCode: "EVV-KL-001" },
    { firstName: "Gurpreet", lastName: "Kaur", email: "gurpreet.kaur@example.com", phone: "9812345691", companyName: null, city: "Ludhiana", state: "Punjab", pincode: "141001", source: "LANDING_PAGE" as const, status: "QUALIFIED" as const, ownerId: ananya.id, dealerCode: "EVV-PB-001" },
    { firstName: "Naveen", lastName: "Reddy", email: "naveen.reddy@example.com", phone: "9812345692", companyName: "Reddy Logistics", city: "Hyderabad", state: "Telangana", pincode: "500001", source: "MANUAL" as const, status: "NURTURING" as const, ownerId: ananya.id, dealerCode: null },
    { firstName: "Priyanka", lastName: "Das", email: "priyanka.das@example.com", phone: "9812345693", companyName: null, city: "Kolkata", state: "West Bengal", pincode: "700001", source: "IMPORT" as const, status: "UNQUALIFIED" as const, ownerId: null, dealerCode: null },
  ];

  const leadIds: Record<string, number> = {};
  for (const l of leadSeeds) {
    const scored = scoreLead(l);
    const lead = await prisma.lead.create({
      data: {
        firstName: l.firstName,
        lastName: l.lastName,
        email: l.email,
        phone: l.phone,
        companyName: l.companyName,
        city: l.city,
        state: l.state,
        pincode: l.pincode,
        source: l.source,
        status: l.status,
        ownerId: l.ownerId,
        assignedAt: l.ownerId ? daysFromNow(-5) : null,
        score: scored.score,
        completenessScore: scored.completenessScore,
        qualityScore: scored.qualityScore,
        missingFields: scored.missingFields,
        invalidFields: scored.invalidFields,
      },
    });
    leadIds[l.email] = lead.id;
    const attributedCampaign = l.source === "LANDING_PAGE" ? (l.dealerCode ? campaign : retailCampaign) : null;
    if (l.source === "LANDING_PAGE") {
      await prisma.enquiry.create({
        data: { leadId: lead.id, landingPageCampaignId: attributedCampaign?.id ?? null, status: "UNRESOLVED", customFields: { vehicleInterest: "Vikas Lifter" } },
      });
      await prisma.formSubmission.create({
        data: { leadId: lead.id, formData: { source: "seed", utm: { utm_source: "seed" } } },
      });
    }
    if (l.dealerCode) {
      await prisma.dealerLeadAssignment.create({
        data: { leadId: lead.id, dealerId: dealers[l.dealerCode]!.id, status: "ASSIGNED", routedBy: "AUTO_TERRITORY" },
      });
    }
  }

  await prisma.leadRemark.createMany({
    data: [
      { leadId: leadIds["anita.rao@example.com"]!, userId: rohit.id, remark: "Called — interested in Vikas Lifter for her delivery fleet. Sending finance options.", createdAt: daysFromNow(-3) },
      { leadId: leadIds["anita.rao@example.com"]!, userId: rohit.id, remark: "Test drive booked for this weekend at Bilaspur EV Hub.", createdAt: daysFromNow(-1) },
      { leadId: leadIds["vikas.kumar@example.com"]!, userId: ananya.id, remark: "Converted — purchased Vikas Rani, invoice INV-2026-000091.", createdAt: daysFromNow(-5) },
      { leadId: leadIds["deepika.menon@example.com"]!, userId: rohit.id, remark: "Not ready to buy yet — revisiting after Q2 budget approval. Added to nurture list.", createdAt: daysFromNow(-2) },
      { leadId: leadIds["yusuf.khan@example.com"]!, userId: karan.id, remark: "Runs a 12-vehicle courier fleet — asked about becoming a dealer for Surat, not just a buyer. Worth converting.", createdAt: daysFromNow(-1) },
    ],
  });

  console.log("Seeding finance cases…");
  await prisma.financeCase.createMany({
    data: [
      { dealerId: dealers["EVV-CG-001"]!.id, buyerName: "Anita Rao", buyerPhone: "9812345678", vehicleModel: "Vikas Lifter", loanAmount: 650000, financierName: "Shriram Finance", status: "SUBMITTED" },
      { dealerId: dealers["EVV-MP-001"]!.id, buyerName: "Vikas Kumar", buyerPhone: "9812345679", vehicleModel: "Vikas Rani", loanAmount: 320000, financierName: "L&T Finance", status: "APPROVED" },
      { dealerId: dealers["EVV-DL-001"]!.id, buyerName: "Rahul Gupta", buyerPhone: "9812345681", vehicleModel: "Vikas Spark", loanAmount: 480000, status: "DOCS_PENDING" },
      { dealerId: dealers["EVV-RJ-001"]!.id, buyerName: "Farah Sheikh", buyerPhone: "9812345680", vehicleModel: "Vikas Loader", loanAmount: 280000, financierName: "Shriram Finance", status: "DISBURSED" },
      { dealerId: dealers["EVV-KA-001"]!.id, buyerName: "Karthik Iyer", buyerPhone: "9812345687", vehicleModel: "Vikas Lifter", loanAmount: 610000, financierName: "L&T Finance", status: "APPROVED" },
      { dealerId: dealers["EVV-GJ-001"]!.id, buyerName: "Rajiv Solanki", buyerPhone: "9812345689", vehicleModel: "Vikas Foodcart", loanAmount: 390000, financierName: "Shriram Finance", status: "DISBURSED" },
      { dealerId: dealers["EVV-PB-001"]!.id, buyerName: "Gurpreet Kaur", buyerPhone: "9812345691", vehicleModel: "Vikas Rani", loanAmount: 300000, status: "SUBMITTED" },
      { dealerId: dealers["EVV-KL-001"]!.id, buyerName: "Meera Pillai", buyerPhone: "9812345690", vehicleModel: "Vikas Loader", loanAmount: 260000, status: "REJECTED" },
    ],
  });

  console.log("Seeding service tickets & spare parts…");
  await prisma.serviceTicket.createMany({
    data: [
      { ticketNumber: "SVC-2026-000001", dealerId: dealers["EVV-CG-001"]!.id, customerName: "Ramesh Yadav", vehicleModel: "Vikas Lifter", chassisNumber: "EVV5X0001", issue: "Battery not charging fully", priority: "HIGH", status: "IN_PROGRESS" },
      { ticketNumber: "SVC-2026-000002", dealerId: dealers["EVV-MP-001"]!.id, customerName: "Sunita Devi", vehicleModel: "Vikas Rani", chassisNumber: "EVV3X0002", issue: "Brake noise", priority: "NORMAL", status: "OPEN" },
      { ticketNumber: "SVC-2026-000003", dealerId: dealers["EVV-DL-001"]!.id, customerName: "Imran Khan", vehicleModel: "Vikas Spark", chassisNumber: "EVV5X0003", issue: "Display flickering", priority: "LOW", status: "RESOLVED", resolvedAt: daysFromNow(-2) },
      { ticketNumber: "SVC-2026-000004", dealerId: dealers["EVV-RJ-001"]!.id, customerName: "Geeta Sharma", vehicleModel: "Vikas Loader", chassisNumber: "EVV3X0004", issue: "Motor overheating on incline", priority: "URGENT", status: "AWAITING_PARTS" },
      { ticketNumber: "SVC-2026-000005", dealerId: dealers["EVV-CG-001"]!.id, customerName: "Om Prakash", vehicleModel: "Vikas Nirmal", chassisNumber: "EVV5X0005", issue: "Routine 5000km service", priority: "LOW", status: "CLOSED", resolvedAt: daysFromNow(-15) },
      { ticketNumber: "SVC-2026-000006", dealerId: dealers["EVV-KA-001"]!.id, customerName: "Karthik Iyer", vehicleModel: "Vikas Lifter", chassisNumber: "EVV5X0011", issue: "Charging port loose", priority: "HIGH", status: "OPEN" },
      { ticketNumber: "SVC-2026-000007", dealerId: dealers["EVV-GJ-001"]!.id, customerName: "Rajiv Solanki", vehicleModel: "Vikas Foodcart", chassisNumber: "EVV5X0012", issue: "Cargo box latch broken", priority: "NORMAL", status: "IN_PROGRESS" },
      { ticketNumber: "SVC-2026-000008", dealerId: dealers["EVV-PB-001"]!.id, customerName: "Gurpreet Kaur", vehicleModel: "Vikas Rani", chassisNumber: "EVV3X0013", issue: "Odometer not updating", priority: "LOW", status: "RESOLVED", resolvedAt: daysFromNow(-4) },
      { ticketNumber: "SVC-2026-000009", dealerId: dealers["EVV-KL-001"]!.id, customerName: "Meera Pillai", vehicleModel: "Vikas Loader", chassisNumber: "EVV3X0014", issue: "Water ingress after monsoon test", priority: "URGENT", status: "AWAITING_PARTS" },
    ],
  });
  await prisma.sparePartRequest.createMany({
    data: [
      { requestNumber: "SPR-2026-000001", dealerId: dealers["EVV-CG-001"]!.id, partName: "Lithium battery pack 60V", partCode: "BATT-60V-L5", quantity: 1, status: "DISPATCHED", dispatchedAt: daysFromNow(-1) },
      { requestNumber: "SPR-2026-000002", dealerId: dealers["EVV-MP-001"]!.id, partName: "Front brake pad set", partCode: "BRK-FR-L3", quantity: 4, status: "REQUESTED" },
      { requestNumber: "SPR-2026-000003", dealerId: dealers["EVV-DL-001"]!.id, partName: "Display cluster", partCode: "DISP-STD", quantity: 2, status: "APPROVED" },
      { requestNumber: "SPR-2026-000004", dealerId: dealers["EVV-RJ-001"]!.id, partName: "Motor controller unit", partCode: "MCU-L3-A", quantity: 1, status: "DELIVERED", dispatchedAt: daysFromNow(-6) },
      { requestNumber: "SPR-2026-000005", dealerId: dealers["EVV-KA-001"]!.id, partName: "Lithium battery pack 60V", partCode: "BATT-60V-L5", quantity: 3, status: "REQUESTED" },
      { requestNumber: "SPR-2026-000006", dealerId: dealers["EVV-KA-001"]!.id, partName: "Front brake pad set", partCode: "BRK-FR-L3", quantity: 6, status: "DISPATCHED", dispatchedAt: daysFromNow(-2) },
      { requestNumber: "SPR-2026-000007", dealerId: dealers["EVV-GJ-001"]!.id, partName: "Cargo latch assembly", partCode: "LATCH-CGO-1", quantity: 5, status: "APPROVED" },
      { requestNumber: "SPR-2026-000008", dealerId: dealers["EVV-PB-001"]!.id, partName: "Motor controller unit", partCode: "MCU-L3-A", quantity: 2, status: "DELIVERED", dispatchedAt: daysFromNow(-9) },
      { requestNumber: "SPR-2026-000009", dealerId: dealers["EVV-KL-001"]!.id, partName: "Display cluster", partCode: "DISP-STD", quantity: 1, status: "CANCELLED" },
      { requestNumber: "SPR-2026-000010", dealerId: dealers["EVV-RJ-001"]!.id, partName: "Front brake pad set", partCode: "BRK-FR-L3", quantity: 2, status: "REQUESTED" },
    ],
  });

  console.log("Seeding vehicle inventory & stock transfers…");
  const vinPrefix = "MA3EVVKS26";
  const units = [
    { vin: `${vinPrefix}000001`, model: "Vikas Lifter", segment: "L5" as const, dealerId: null, status: "IN_STOCK" as const },
    { vin: `${vinPrefix}000002`, model: "Vikas Lifter", segment: "L5" as const, dealerId: dealers["EVV-CG-001"]!.id, status: "ALLOCATED" as const, allocatedAt: daysFromNow(-10) },
    { vin: `${vinPrefix}000003`, model: "Vikas Rani", segment: "L3" as const, dealerId: dealers["EVV-MP-001"]!.id, status: "IN_STOCK" as const, allocatedAt: daysFromNow(-20) },
    { vin: `${vinPrefix}000004`, model: "Vikas Rani", segment: "L3" as const, dealerId: dealers["EVV-MP-001"]!.id, status: "SOLD" as const, allocatedAt: daysFromNow(-40), soldAt: daysFromNow(-5), buyerName: "Vikas Kumar", invoiceNumber: "INV-2026-000091" },
    { vin: `${vinPrefix}000005`, model: "Vikas Spark", segment: "L5" as const, dealerId: dealers["EVV-DL-001"]!.id, status: "DEMO" as const, isDemoUnit: true, batteryHealthPct: 92, allocatedAt: daysFromNow(-90) },
    { vin: `${vinPrefix}000006`, model: "Vikas Loader", segment: "L3" as const, dealerId: dealers["EVV-RJ-001"]!.id, status: "SOLD" as const, allocatedAt: daysFromNow(-500), soldAt: daysFromNow(-480), buyerName: "Farah Sheikh", invoiceNumber: "INV-2026-000077" },
    { vin: `${vinPrefix}000007`, model: "Vikas Foodcart", segment: "CUSTOMISED" as const, dealerId: dealers["EVV-CG-001"]!.id, status: "IN_STOCK" as const, allocatedAt: daysFromNow(-3) },
    { vin: `${vinPrefix}000008`, model: "Vikas Lifter", segment: "L5" as const, dealerId: null, status: "IN_TRANSIT" as const },
    { vin: `${vinPrefix}000009`, model: "Vikas Soorma", segment: "L5" as const, dealerId: dealers["EVV-DL-001"]!.id, status: "SERVICE_HOLD" as const, allocatedAt: daysFromNow(-50) },
    { vin: `${vinPrefix}000010`, model: "Vikas Carry", segment: "L3" as const, dealerId: null, status: "IN_STOCK" as const },
    { vin: `${vinPrefix}000011`, model: "Vikas Lifter", segment: "L5" as const, dealerId: dealers["EVV-KA-001"]!.id, status: "ALLOCATED" as const, allocatedAt: daysFromNow(-14) },
    { vin: `${vinPrefix}000012`, model: "Vikas Foodcart", segment: "CUSTOMISED" as const, dealerId: dealers["EVV-GJ-001"]!.id, status: "SOLD" as const, allocatedAt: daysFromNow(-60), soldAt: daysFromNow(-12), buyerName: "Rajiv Solanki", invoiceNumber: "INV-2026-000102" },
    { vin: `${vinPrefix}000013`, model: "Vikas Rani", segment: "L3" as const, dealerId: dealers["EVV-PB-001"]!.id, status: "ALLOCATED" as const, allocatedAt: daysFromNow(-25) },
    { vin: `${vinPrefix}000014`, model: "Vikas Loader", segment: "L3" as const, dealerId: dealers["EVV-KL-001"]!.id, status: "SERVICE_HOLD" as const, allocatedAt: daysFromNow(-30) },
    { vin: `${vinPrefix}000015`, model: "Vikas Lifter", segment: "L5" as const, dealerId: dealers["EVV-KA-001"]!.id, status: "IN_STOCK" as const, allocatedAt: daysFromNow(-7) },
    { vin: `${vinPrefix}000016`, model: "Vikas Spark", segment: "L5" as const, dealerId: null, status: "IN_STOCK" as const },
    { vin: `${vinPrefix}000017`, model: "Vikas Spark", segment: "L5" as const, dealerId: dealers["EVV-GJ-001"]!.id, status: "DEMO" as const, isDemoUnit: true, batteryHealthPct: 96, allocatedAt: daysFromNow(-30) },
    { vin: `${vinPrefix}000018`, model: "Vikas Rani", segment: "L3" as const, dealerId: null, status: "IN_TRANSIT" as const },
    { vin: `${vinPrefix}000019`, model: "Vikas Nirmal", segment: "L5" as const, dealerId: dealers["EVV-PB-001"]!.id, status: "SOLD" as const, allocatedAt: daysFromNow(-90), soldAt: daysFromNow(-30), buyerName: "Gurpreet Kaur", invoiceNumber: "INV-2026-000108" },
    { vin: `${vinPrefix}000020`, model: "Vikas Carry", segment: "L3" as const, dealerId: dealers["EVV-KL-001"]!.id, status: "IN_STOCK" as const, allocatedAt: daysFromNow(-6) },
  ];
  const createdUnits: Record<string, Awaited<ReturnType<typeof prisma.vehicleUnit.create>>> = {};
  for (const u of units) {
    const unit = await prisma.vehicleUnit.create({ data: u });
    createdUnits[u.vin] = unit;
  }

  await prisma.stockTransferRequest.createMany({
    data: [
      { requestNumber: "STR-2026-000001", dealerId: dealers["EVV-RJ-001"]!.id, model: "Vikas Lifter", segment: "L5", quantity: 2, status: "REQUESTED" },
      { requestNumber: "STR-2026-000002", dealerId: dealers["EVV-MP-001"]!.id, model: "Vikas Rani", segment: "L3", quantity: 3, status: "APPROVED" },
      { requestNumber: "STR-2026-000003", dealerId: dealers["EVV-CG-001"]!.id, model: "Vikas Spark", segment: "L5", quantity: 1, status: "DISPATCHED", dispatchedAt: daysFromNow(-2) },
      { requestNumber: "STR-2026-000004", dealerId: dealers["EVV-KA-001"]!.id, model: "Vikas Lifter", segment: "L5", quantity: 4, status: "DELIVERED", dispatchedAt: daysFromNow(-8), deliveredAt: daysFromNow(-3) },
      { requestNumber: "STR-2026-000005", dealerId: dealers["EVV-KA-001"]!.id, model: "Vikas Spark", segment: "L5", quantity: 2, status: "REQUESTED" },
      { requestNumber: "STR-2026-000006", dealerId: dealers["EVV-GJ-001"]!.id, model: "Vikas Foodcart", segment: "CUSTOMISED", quantity: 2, status: "APPROVED" },
      { requestNumber: "STR-2026-000007", dealerId: dealers["EVV-GJ-001"]!.id, model: "Vikas Rani", segment: "L3", quantity: 1, status: "REJECTED" },
      { requestNumber: "STR-2026-000008", dealerId: dealers["EVV-PB-001"]!.id, model: "Vikas Rani", segment: "L3", quantity: 3, status: "DISPATCHED", dispatchedAt: daysFromNow(-1) },
      { requestNumber: "STR-2026-000009", dealerId: dealers["EVV-PB-001"]!.id, model: "Vikas Nirmal", segment: "L5", quantity: 1, status: "CANCELLED" },
      { requestNumber: "STR-2026-000010", dealerId: dealers["EVV-KL-001"]!.id, model: "Vikas Carry", segment: "L3", quantity: 2, status: "REQUESTED" },
      { requestNumber: "STR-2026-000011", dealerId: dealers["EVV-KL-001"]!.id, model: "Vikas Loader", segment: "L3", quantity: 1, status: "DELIVERED", dispatchedAt: daysFromNow(-20), deliveredAt: daysFromNow(-15) },
      { requestNumber: "STR-2026-000012", dealerId: dealers["EVV-DL-001"]!.id, model: "Vikas Lifter", segment: "L5", quantity: 5, status: "APPROVED" },
    ],
  });

  console.log("Seeding purchase orders (manufacturer's own inbound stock)…");
  await prisma.vehiclePurchaseOrder.createMany({
    data: [
      { poNumber: "PO-2026-000001", supplierName: "EV Vikas Manufacturing — Pune Plant", model: "Vikas Lifter", segment: "L5", quantity: 20, unitCost: 285000, status: "RECEIVED", orderedAt: daysFromNow(-60), expectedAt: daysFromNow(-45), receivedAt: daysFromNow(-42) },
      { poNumber: "PO-2026-000002", supplierName: "EV Vikas Manufacturing — Pune Plant", model: "Vikas Rani", segment: "L3", quantity: 15, unitCost: 210000, status: "RECEIVED", orderedAt: daysFromNow(-50), expectedAt: daysFromNow(-35), receivedAt: daysFromNow(-33) },
      { poNumber: "PO-2026-000003", supplierName: "EV Vikas Manufacturing — Chennai Plant", model: "Vikas Spark", segment: "L5", quantity: 10, unitCost: 310000, status: "RECEIVED", orderedAt: daysFromNow(-40), expectedAt: daysFromNow(-25), receivedAt: daysFromNow(-24) },
      { poNumber: "PO-2026-000004", supplierName: "EV Vikas Manufacturing — Chennai Plant", model: "Vikas Loader", segment: "L3", quantity: 12, unitCost: 195000, status: "RECEIVED", orderedAt: daysFromNow(-35), expectedAt: daysFromNow(-20), receivedAt: daysFromNow(-18) },
      { poNumber: "PO-2026-000005", supplierName: "EV Vikas Manufacturing — Pune Plant", model: "Vikas Lifter", segment: "L5", quantity: 18, unitCost: 288000, status: "IN_TRANSIT", orderedAt: daysFromNow(-14), expectedAt: daysFromNow(3) },
      { poNumber: "PO-2026-000006", supplierName: "Imported — TorqueDrive Assembly (Thailand)", model: "Vikas Foodcart", segment: "CUSTOMISED", quantity: 6, unitCost: 340000, status: "IN_TRANSIT", orderedAt: daysFromNow(-10), expectedAt: daysFromNow(6) },
      { poNumber: "PO-2026-000007", supplierName: "EV Vikas Manufacturing — Chennai Plant", model: "Vikas Rani", segment: "L3", quantity: 20, unitCost: 212000, status: "ORDERED", orderedAt: daysFromNow(-3), expectedAt: daysFromNow(20) },
      { poNumber: "PO-2026-000008", supplierName: "EV Vikas Manufacturing — Pune Plant", model: "Vikas Nirmal", segment: "L5", quantity: 8, unitCost: 265000, status: "ORDERED", orderedAt: daysFromNow(-1), expectedAt: daysFromNow(25) },
      { poNumber: "PO-2026-000009", supplierName: "Imported — TorqueDrive Assembly (Thailand)", model: "Vikas Soorma", segment: "L5", quantity: 5, unitCost: 355000, status: "CANCELLED", orderedAt: daysFromNow(-25), notes: "Supplier missed the committed window twice — reordering domestically instead." },
    ],
  });

  console.log("Seeding compliance records…");
  const complianceSeeds: { dealerCode: string; docType: any; docNumber: string; issuedAt: Date; expiresAt: Date | null }[] = [
    { dealerCode: "EVV-CG-001", docType: "DEALER_AGREEMENT", docNumber: "DA-CG-001", issuedAt: daysFromNow(-400), expiresAt: daysFromNow(600) },
    { dealerCode: "EVV-CG-001", docType: "INSURANCE_POLICY", docNumber: "INS-CG-001", issuedAt: daysFromNow(-350), expiresAt: daysFromNow(15) },
    { dealerCode: "EVV-CG-001", docType: "TRADE_LICENSE", docNumber: "TL-CG-001", issuedAt: daysFromNow(-700), expiresAt: daysFromNow(-20) },
    { dealerCode: "EVV-MP-001", docType: "DEALER_AGREEMENT", docNumber: "DA-MP-001", issuedAt: daysFromNow(-300), expiresAt: daysFromNow(400) },
    { dealerCode: "EVV-MP-001", docType: "FIRE_NOC", docNumber: "FNOC-MP-001", issuedAt: daysFromNow(-200), expiresAt: daysFromNow(200) },
    { dealerCode: "EVV-RJ-001", docType: "DEALER_AGREEMENT", docNumber: "DA-RJ-001", issuedAt: daysFromNow(-500), expiresAt: daysFromNow(90) },
    { dealerCode: "EVV-RJ-001", docType: "INSURANCE_POLICY", docNumber: "INS-RJ-001", issuedAt: daysFromNow(-360), expiresAt: daysFromNow(5) },
    { dealerCode: "EVV-DL-001", docType: "DEALER_AGREEMENT", docNumber: "DA-DL-001", issuedAt: daysFromNow(-250), expiresAt: daysFromNow(800) },
    { dealerCode: "EVV-DL-001", docType: "POLLUTION_NOC", docNumber: "PNOC-DL-001", issuedAt: daysFromNow(-100), expiresAt: null },
    { dealerCode: "EVV-KA-001", docType: "DEALER_AGREEMENT", docNumber: "DA-KA-001", issuedAt: daysFromNow(-300), expiresAt: daysFromNow(500) },
    { dealerCode: "EVV-KA-001", docType: "TRADE_LICENSE", docNumber: "TL-KA-001", issuedAt: daysFromNow(-360), expiresAt: daysFromNow(10) },
    { dealerCode: "EVV-KA-001", docType: "GST_CERTIFICATE", docNumber: "GST-KA-001", issuedAt: daysFromNow(-300), expiresAt: daysFromNow(300) },
    { dealerCode: "EVV-GJ-001", docType: "DEALER_AGREEMENT", docNumber: "DA-GJ-001", issuedAt: daysFromNow(-200), expiresAt: daysFromNow(600) },
    { dealerCode: "EVV-GJ-001", docType: "INSURANCE_POLICY", docNumber: "INS-GJ-001", issuedAt: daysFromNow(-400), expiresAt: daysFromNow(-10) },
    { dealerCode: "EVV-PB-001", docType: "DEALER_AGREEMENT", docNumber: "DA-PB-001", issuedAt: daysFromNow(-180), expiresAt: daysFromNow(650) },
    { dealerCode: "EVV-PB-001", docType: "FIRE_NOC", docNumber: "FNOC-PB-001", issuedAt: daysFromNow(-90), expiresAt: daysFromNow(20) },
    { dealerCode: "EVV-KL-001", docType: "DEALER_AGREEMENT", docNumber: "DA-KL-001", issuedAt: daysFromNow(-150), expiresAt: daysFromNow(700) },
    { dealerCode: "EVV-KL-001", docType: "POLLUTION_NOC", docNumber: "PNOC-KL-001", issuedAt: daysFromNow(-60), expiresAt: null },
  ];
  for (const c of complianceSeeds) {
    await prisma.dealerComplianceRecord.create({
      data: {
        dealerId: dealers[c.dealerCode]!.id,
        docType: c.docType,
        docNumber: c.docNumber,
        issuedAt: c.issuedAt,
        expiresAt: c.expiresAt,
        status: complianceStatus(c.expiresAt),
      },
    });
  }

  // ---------------------------------------------------------------------
  // CENTREPIECE — Warranty Management: plans, serials, claims, recovery
  // ---------------------------------------------------------------------
  console.log("Seeding warranty plans…");
  const planSeeds = [
    { name: "Vikas Lifter — Battery", vehicleModel: "Vikas Lifter", componentType: "BATTERY" as const, termMonths: 60, termKm: 100000, sohFloorPct: 70, approvedChargers: "EV Vikas OEM Charger,EV Vikas Fast Charger" },
    { name: "Vikas Lifter — Motor", vehicleModel: "Vikas Lifter", componentType: "MOTOR" as const, termMonths: 36, termKm: 60000, sohFloorPct: null, approvedChargers: null },
    { name: "Vikas Lifter — Controller", vehicleModel: "Vikas Lifter", componentType: "CONTROLLER" as const, termMonths: 24, termKm: null, sohFloorPct: null, approvedChargers: null },
    { name: "Vikas Rani — Battery", vehicleModel: "Vikas Rani", componentType: "BATTERY" as const, termMonths: 48, termKm: 80000, sohFloorPct: 70, approvedChargers: "EV Vikas OEM Charger" },
    { name: "Vikas Rani — Motor", vehicleModel: "Vikas Rani", componentType: "MOTOR" as const, termMonths: 36, termKm: 50000, sohFloorPct: null, approvedChargers: null },
    { name: "Vikas Loader — Motor", vehicleModel: "Vikas Loader", componentType: "MOTOR" as const, termMonths: 36, termKm: 50000, sohFloorPct: null, approvedChargers: null },
    { name: "Vikas Loader — Controller", vehicleModel: "Vikas Loader", componentType: "CONTROLLER" as const, termMonths: 24, termKm: null, sohFloorPct: null, approvedChargers: null },
    { name: "Vikas Spark — Battery", vehicleModel: "Vikas Spark", componentType: "BATTERY" as const, termMonths: 60, termKm: 100000, sohFloorPct: 70, approvedChargers: "EV Vikas OEM Charger,EV Vikas Fast Charger" },
  ];
  const plans: Record<string, Awaited<ReturnType<typeof prisma.warrantyPlan.create>>> = {};
  for (const p of planSeeds) {
    const plan = await prisma.warrantyPlan.create({ data: p });
    plans[`${p.vehicleModel}:${p.componentType}`] = plan;
  }

  console.log("Seeding component serial registry…");
  async function registerComponent(serial: string, componentType: "BATTERY" | "MOTOR" | "CONTROLLER", model: string, vin: string, supplier: string, batch: string, registeredMonthsAgo: number) {
    return prisma.componentUnit.create({
      data: {
        serialNumber: serial,
        componentType,
        supplierName: supplier,
        batchNumber: batch,
        vehicleUnitId: createdUnits[vin]?.id ?? null,
        planId: plans[`${model}:${componentType}`]?.id ?? null,
        registeredAt: monthsFromNow(-registeredMonthsAgo),
      },
    });
  }

  const cu1 = await registerComponent("BATT-CG-0002-2024", "BATTERY", "Vikas Lifter", `${vinPrefix}000002`, "PowerCell Energy Pvt Ltd", "PC-2024-B117", 8);
  await registerComponent("MTR-CG-0002-2024", "MOTOR", "Vikas Lifter", `${vinPrefix}000002`, "TorqueDrive Motors", "TD-2024-M045", 8);
  const cu4 = await registerComponent("BATT-MP-0004-2020", "BATTERY", "Vikas Rani", `${vinPrefix}000004`, "PowerCell Energy Pvt Ltd", "PC-2020-B033", 62); // deliberately out of term
  const cu6 = await registerComponent("MTR-RJ-0006-2025", "MOTOR", "Vikas Loader", `${vinPrefix}000006`, "TorqueDrive Motors", "TD-2025-M201", 20);
  await registerComponent("BATT-DL-0005-2026", "BATTERY", "Vikas Spark", `${vinPrefix}000005`, "PowerCell Energy Pvt Ltd", "PC-2026-B301", 3);
  const cu11 = await registerComponent("BATT-KA-0011-2025", "BATTERY", "Vikas Lifter", `${vinPrefix}000011`, "PowerCell Energy Pvt Ltd", "PC-2025-B210", 14);
  const cu14 = await registerComponent("MTR-KL-0014-2024", "MOTOR", "Vikas Loader", `${vinPrefix}000014`, "TorqueDrive Motors", "TD-2024-M133", 26);

  console.log("Seeding warranty claims & supplier recovery (the closed loop)…");

  // Claim 1 — auto-approved (clean, within term, approved charger, no duplicate).
  const claim1 = await prisma.warrantyClaim.create({
    data: {
      claimNumber: "WC-2026-000001",
      dealerId: dealers["EVV-CG-001"]!.id,
      vehicleUnitId: createdUnits[`${vinPrefix}000002`]!.id,
      componentUnitId: cu1.id,
      planId: plans["Vikas Lifter:BATTERY"]!.id,
      chassisNumber: `${vinPrefix}000002`,
      customerName: "Ramesh Yadav",
      customerPhone: "9812399001",
      issueDescription: "Battery capacity degraded — customer reports reduced range on full charge.",
      odometerReading: 8200,
      measuredSohPct: 64,
      chargerType: "EV Vikas OEM Charger",
      serviceRecordsComplete: true,
      claimAmount: 45000,
      approvedAmount: 45000,
      status: "IN_REPAIR",
      adjudicationNotes: "Within time term: 8 of 60 months elapsed. Within distance term: 8200 of 100000km. Measured SoH 64% is below the 70% floor — capacity claim valid. Charger \"EV Vikas OEM Charger\" is an approved accessory. Service records complete. No open duplicate claim for this component.",
      submittedAt: daysFromNow(-6),
    },
  });
  await prisma.warrantyClaimEvent.createMany({
    data: [
      { claimId: claim1.id, fromStatus: null, toStatus: "APPROVED", note: "Auto-adjudication: AUTO_APPROVE.", actorId: null, createdAt: daysFromNow(-6) },
      { claimId: claim1.id, fromStatus: "APPROVED", toStatus: "IN_REPAIR", note: "Battery module replaced at workshop (JC-2026-000001).", actorId: admin.id, createdAt: daysFromNow(-4) },
    ],
  });

  // Claim 2 — reimbursed, closed-loop supplier recovery opened (the demo storyline).
  const claim2 = await prisma.warrantyClaim.create({
    data: {
      claimNumber: "WC-2026-000002",
      dealerId: dealers["EVV-RJ-001"]!.id,
      vehicleUnitId: createdUnits[`${vinPrefix}000006`]!.id,
      componentUnitId: cu6.id,
      planId: plans["Vikas Loader:MOTOR"]!.id,
      chassisNumber: `${vinPrefix}000006`,
      customerName: "Farah Sheikh",
      customerPhone: "9812345680",
      issueDescription: "Motor controller fault — vehicle loses power intermittently under load.",
      odometerReading: 18500,
      serviceRecordsComplete: true,
      claimAmount: 12000,
      approvedAmount: 12000,
      status: "RECOVERY",
      partReturned: true,
      partReturnedAt: daysFromNow(-10),
      adjudicationNotes: "Within time term: 20 of 36 months elapsed. Within distance term: 18500 of 50000km. Service records complete. No open duplicate claim for this component.",
      submittedAt: daysFromNow(-22),
      resolvedAt: daysFromNow(-8),
    },
  });
  await prisma.warrantyClaimEvent.createMany({
    data: [
      { claimId: claim2.id, fromStatus: null, toStatus: "APPROVED", note: "Auto-adjudication: AUTO_APPROVE.", actorId: null, createdAt: daysFromNow(-22) },
      { claimId: claim2.id, fromStatus: "APPROVED", toStatus: "IN_REPAIR", note: "Motor controller swapped, faulty unit tagged for return.", actorId: admin.id, createdAt: daysFromNow(-16) },
      { claimId: claim2.id, fromStatus: "IN_REPAIR", toStatus: "REIMBURSED", note: "₹12,000 credited to dealer ledger.", actorId: admin.id, createdAt: daysFromNow(-10) },
      { claimId: claim2.id, fromStatus: "REIMBURSED", toStatus: "RECOVERY", note: "Returned controller inspected — confirmed manufacturing defect. Recovery opened against TorqueDrive Motors.", actorId: admin.id, createdAt: daysFromNow(-8) },
    ],
  });
  await prisma.supplierRecovery.create({
    data: {
      claimId: claim2.id,
      supplierName: "TorqueDrive Motors",
      componentType: "MOTOR",
      amount: 12000,
      status: "OPEN",
      openedAt: daysFromNow(-8),
      notes: "Batch TD-2025-M201 — controller inspection confirmed a manufacturing defect, not misuse.",
    },
  });

  // Claim 3 — void: battery is out of its 48-month term (registered 62 months ago).
  const claim3 = await prisma.warrantyClaim.create({
    data: {
      claimNumber: "WC-2026-000003",
      dealerId: dealers["EVV-MP-001"]!.id,
      vehicleUnitId: createdUnits[`${vinPrefix}000004`]!.id,
      componentUnitId: cu4.id,
      planId: plans["Vikas Rani:BATTERY"]!.id,
      chassisNumber: `${vinPrefix}000004`,
      customerName: "Vikas Kumar",
      customerPhone: "9812345679",
      issueDescription: "Battery charging port corrosion, reduced charge rate.",
      odometerReading: 41000,
      measuredSohPct: 58,
      chargerType: "EV Vikas OEM Charger",
      serviceRecordsComplete: true,
      claimAmount: 8000,
      status: "REJECTED",
      voidReason: "Outside time term: 62 months since registration vs. a 48-month cover.",
      rejectionReason: "Outside warranty term.",
      adjudicationNotes: "Outside time term: 62 months since registration vs. a 48-month cover. Within distance term: 41000 of 80000km. Measured SoH 58% is below the 70% floor — capacity claim valid. Charger \"EV Vikas OEM Charger\" is an approved accessory. Service records complete. No open duplicate claim for this component.",
      submittedAt: daysFromNow(-3),
      resolvedAt: daysFromNow(-3),
    },
  });
  await prisma.warrantyClaimEvent.create({
    data: { claimId: claim3.id, fromStatus: null, toStatus: "REJECTED", note: "Auto-adjudication: VOID — outside time term.", actorId: null, createdAt: daysFromNow(-3) },
  });

  // Claim 4 — freshly submitted, needs manual review (no component serial linked yet).
  const claim4 = await prisma.warrantyClaim.create({
    data: {
      claimNumber: "WC-2026-000004",
      dealerId: dealers["EVV-DL-001"]!.id,
      vehicleUnitId: createdUnits[`${vinPrefix}000005`]!.id,
      chassisNumber: `${vinPrefix}000005`,
      customerName: "Test Drive Customer",
      issueDescription: "Suspension noise reported during demo drive.",
      status: "UNDER_REVIEW",
      adjudicationNotes: "No warranty plan on file for this vehicle model/component — routed for manual review.",
      submittedAt: daysFromNow(-1),
    },
  });
  await prisma.warrantyClaimEvent.create({
    data: { claimId: claim4.id, fromStatus: null, toStatus: "UNDER_REVIEW", note: "Auto-adjudication: NEEDS_REVIEW — no plan on file.", actorId: null, createdAt: daysFromNow(-1) },
  });

  // Claim 5 — awaiting more information from the dealer before adjudication can proceed.
  const claim5 = await prisma.warrantyClaim.create({
    data: {
      claimNumber: "WC-2026-000005",
      dealerId: dealers["EVV-KL-001"]!.id,
      vehicleUnitId: createdUnits[`${vinPrefix}000014`]!.id,
      componentUnitId: cu14.id,
      planId: plans["Vikas Loader:MOTOR"]!.id,
      chassisNumber: `${vinPrefix}000014`,
      customerName: "Meera Pillai",
      customerPhone: "9812345690",
      issueDescription: "Motor cuts out after prolonged rain exposure — suspected water ingress.",
      odometerReading: 6400,
      serviceRecordsComplete: false,
      claimAmount: 9500,
      status: "INFO_REQUESTED",
      adjudicationNotes: "Within time term: 26 of 36 months elapsed. Within distance term: 6400 of 50000km. Service records incomplete — requested the dealer's last two service invoices before adjudication can proceed.",
      submittedAt: daysFromNow(-4),
    },
  });
  await prisma.warrantyClaimEvent.create({
    data: { claimId: claim5.id, fromStatus: null, toStatus: "INFO_REQUESTED", note: "Auto-adjudication: NEEDS_REVIEW — service records incomplete.", actorId: null, createdAt: daysFromNow(-4) },
  });

  // Claim 6 — full lifecycle to CLOSED, no supplier fault found (no recovery opened).
  const claim6 = await prisma.warrantyClaim.create({
    data: {
      claimNumber: "WC-2026-000006",
      dealerId: dealers["EVV-KA-001"]!.id,
      vehicleUnitId: createdUnits[`${vinPrefix}000011`]!.id,
      componentUnitId: cu11.id,
      planId: plans["Vikas Lifter:BATTERY"]!.id,
      chassisNumber: `${vinPrefix}000011`,
      customerName: "Karthik Iyer",
      customerPhone: "9812345687",
      issueDescription: "Battery pack showed a one-time fault code, cleared itself — customer requested inspection.",
      odometerReading: 4100,
      measuredSohPct: 97,
      chargerType: "EV Vikas OEM Charger",
      serviceRecordsComplete: true,
      claimAmount: 3500,
      approvedAmount: 3500,
      status: "CLOSED",
      adjudicationNotes: "Within time term: 14 of 60 months elapsed. Within distance term: 4100 of 100000km. Measured SoH 97% — no capacity fault found. Charger approved. Service records complete.",
      submittedAt: daysFromNow(-45),
      resolvedAt: daysFromNow(-30),
    },
  });
  await prisma.warrantyClaimEvent.createMany({
    data: [
      { claimId: claim6.id, fromStatus: null, toStatus: "APPROVED", note: "Auto-adjudication: AUTO_APPROVE.", actorId: null, createdAt: daysFromNow(-45) },
      { claimId: claim6.id, fromStatus: "APPROVED", toStatus: "IN_REPAIR", note: "Inspected — loose BMS connector reseated, no part replaced.", actorId: admin.id, createdAt: daysFromNow(-38) },
      { claimId: claim6.id, fromStatus: "IN_REPAIR", toStatus: "REIMBURSED", note: "Labour-only claim reimbursed.", actorId: admin.id, createdAt: daysFromNow(-33) },
      { claimId: claim6.id, fromStatus: "REIMBURSED", toStatus: "CLOSED", note: "No part fault found — closed without supplier recovery.", actorId: admin.id, createdAt: daysFromNow(-30) },
    ],
  });

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
