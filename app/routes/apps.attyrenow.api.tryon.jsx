import { authenticate, unauthenticated, PLAN_LIMITS } from "../shopify.server";
import db from "../db.server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DEFAULT_LIMIT = 50;

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// --- Per-shop rate limiting (protects the store's shared pool from bursts) ---
const shopRateLimitMap = new Map();
const SHOP_RATE_WINDOW_MS = 60 * 1000;
const SHOP_RATE_MAX = 10; // generous, just to stop runaway loops/bugs

function isShopRateLimited(shop) {
  const now = Date.now();
  const timestamps = (shopRateLimitMap.get(shop) || []).filter(
    (t) => now - t < SHOP_RATE_WINDOW_MS
  );
  if (timestamps.length >= SHOP_RATE_MAX) {
    shopRateLimitMap.set(shop, timestamps);
    return true;
  }
  timestamps.push(now);
  shopRateLimitMap.set(shop, timestamps);
  return false;
}

// --- Per-shopper (IP) rate limiting: 3/minute, 25/day ---
const ipMinuteMap = new Map();
const ipDayMap = new Map();
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const IP_PER_MINUTE_MAX = 3;
const IP_PER_DAY_MAX = 5;

function getClientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

function isIpRateLimited(ip) {
  const now = Date.now();

  const minuteTimestamps = (ipMinuteMap.get(ip) || []).filter(
    (t) => now - t < MINUTE_MS
  );
  if (minuteTimestamps.length >= IP_PER_MINUTE_MAX) {
    ipMinuteMap.set(ip, minuteTimestamps);
    return "You're generating too quickly. Please wait a minute and try again.";
  }

  const dayTimestamps = (ipDayMap.get(ip) || []).filter(
    (t) => now - t < DAY_MS
  );
  if (dayTimestamps.length >= IP_PER_DAY_MAX) {
    ipDayMap.set(ip, dayTimestamps);
    return "You've reached today's try-on limit. Please try again tomorrow.";
  }

  minuteTimestamps.push(now);
  dayTimestamps.push(now);
  ipMinuteMap.set(ip, minuteTimestamps);
  ipDayMap.set(ip, dayTimestamps);
  return null;
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function getShopPlanLimit(shop) {
  try {
    const { billing } = await unauthenticated.admin(shop);
    const { hasActivePayment, appSubscriptions } = await billing.check({
      isTest: process.env.NODE_ENV !== "production",
    });

    if (hasActivePayment && appSubscriptions?.[0]?.name) {
      const planName = appSubscriptions[0].name;
      return PLAN_LIMITS[planName] || DEFAULT_LIMIT;
    }
  } catch (err) {
    console.log("Could not check billing plan:", err);
  }
  return DEFAULT_LIMIT;
}

export const action = async ({ request }) => {
  console.log("STEP 0: request received");
  const { session } = await authenticate.public.appProxy(request);
  const shop = session?.shop;
  console.log("STEP 0 done, shop:", shop);

  if (!shop) {
    return Response.json({ error: "Could not identify store." }, { status: 400 });
  }

  const clientIp = getClientIp(request);

  // Per-shopper limit — checked first, only blocks this one visitor
  const ipLimitMessage = isIpRateLimited(clientIp);
  if (ipLimitMessage) {
    return Response.json({ error: ipLimitMessage }, { status: 429 });
  }

  // Per-shop burst limit — protects against runaway loops/bugs hitting the store's pool
  if (isShopRateLimited(shop)) {
    return Response.json(
      { error: "Too many requests right now. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  const month = currentMonthKey();
  const monthlyLimit = await getShopPlanLimit(shop);

  let usage = await db.tryOnUsage.findUnique({
    where: { shop_month: { shop, month } },
  });

  if (!usage) {
    usage = await db.tryOnUsage.create({
      data: { shop, month, count: 0 },
    });
  }

  if (usage.count >= monthlyLimit) {
    return Response.json(
      { error: "Monthly try-on limit reached for this store. Please upgrade your plan." },
      { status: 429 }
    );
  }

  const formData = await request.formData();
  const humanImage = formData.get("humanImage");
  const garmentImageUrl = formData.get("garmentImageUrl");
  console.log("STEP 0.5: garmentImageUrl is", garmentImageUrl);

  if (!humanImage || !garmentImageUrl) {
    return Response.json({ error: "Missing image data." }, { status: 400 });
  }

  // Input validation — file type and size
  if (!ALLOWED_TYPES.includes(humanImage.type)) {
    return Response.json(
      { error: "Unsupported file type. Please upload a JPG, PNG, or WEBP image." },
      { status: 400 }
    );
  }

  if (humanImage.size > MAX_FILE_SIZE) {
    return Response.json(
      { error: "File too large. Please upload an image under 10MB." },
      { status: 400 }
    );
  }

  try {
    console.log("STEP 1: converting uploaded photo");
    const humanBuffer = Buffer.from(await humanImage.arrayBuffer());
    const humanBase64 = humanBuffer.toString("base64");
    console.log("STEP 1 done");

    const fullGarmentUrl = garmentImageUrl.startsWith("//")
      ? `https:${garmentImageUrl}`
      : garmentImageUrl;
    console.log("STEP 2: fetching product image from", fullGarmentUrl);
    const garmentResponse = await fetch(fullGarmentUrl);
    console.log("STEP 2 done, status:", garmentResponse.status);
    const garmentBuffer = Buffer.from(await garmentResponse.arrayBuffer());
    const garmentBase64 = garmentBuffer.toString("base64");

    console.log("STEP 3: calling Gemini API");
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: "Take the person in the first image and realistically place them wearing the garment shown in the second image. Keep the person's pose, face, and background consistent.",
                },
                {
                  inline_data: {
                    mime_type: humanImage.type || "image/jpeg",
                    data: humanBase64,
                  },
                },
                {
                  inline_data: {
                    mime_type: "image/jpeg",
                    data: garmentBase64,
                  },
                },
              ],
            },
          ],
        }),
      }
    );
    console.log("STEP 3 done, Gemini status:", geminiResponse.status);

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.log("STEP 3 FAILED:", JSON.stringify(geminiData));
      return Response.json(
        { error: "Image generation failed.", details: geminiData },
        { status: 502 }
      );
    }

    const parts = geminiData?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inline_data || p.inlineData);
    const resultBase64 =
      imagePart?.inline_data?.data || imagePart?.inlineData?.data;

    if (!resultBase64) {
      console.log("STEP 4 FAILED: no image in response", JSON.stringify(geminiData));
      return Response.json({ error: "No image returned." }, { status: 502 });
    }

    await db.tryOnUsage.update({
      where: { shop_month: { shop, month } },
      data: { count: { increment: 1 } },
    });

    console.log("STEP 5: success");
    return Response.json({
      resultImage: `data:image/jpeg;base64,${resultBase64}`,
      remaining: monthlyLimit - (usage.count + 1),
    });
  } catch (err) {
    console.log("CRASHED:", err);
    return Response.json(
      { error: "Unexpected error generating try-on.", details: String(err) },
      { status: 500 }
    );
  }
};