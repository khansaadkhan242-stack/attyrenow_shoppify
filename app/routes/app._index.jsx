import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

const PLANS = [
  { key: "Starter", price: "$14.99", limit: 50 },
  { key: "Growth", price: "$34.99", limit: 250 },
  { key: "Pro", price: "$79.99", limit: 750 },
];

export const loader = async ({ request }) => {
  const { billing } = await authenticate.admin(request);

  const { hasActivePayment, appSubscriptions } = await billing.check({
    isTest: process.env.NODE_ENV !== "production",
  });

  const activePlan = hasActivePayment ? appSubscriptions[0]?.name : null;

  return { activePlan };
};

export const action = async ({ request }) => {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const plan = formData.get("plan");

  return billing.request({
    plan,
    isTest: process.env.NODE_ENV !== "production",
  });
};

export default function Index() {
  const { activePlan } = useLoaderData();
  const fetcher = useFetcher();

  const subscribe = (plan) => {
    fetcher.submit({ plan }, { method: "POST" });
  };

  return (
    <s-page heading="AttyreNow Virtual Try-On">
      <s-section heading="Choose your plan">
        <s-paragraph>
          {activePlan
            ? `You're currently on the ${activePlan} plan.`
            : "Pick a plan to start offering virtual try-on on your product pages."}
        </s-paragraph>

        <s-stack direction="inline" gap="base">
          {PLANS.map((plan) => (
            <s-box
              key={plan.key}
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background={activePlan === plan.key ? "subdued" : undefined}
            >
              <s-stack direction="block" gap="tight">
                <s-heading>{plan.key}</s-heading>
                <s-text>{plan.price} / month</s-text>
                <s-text>{plan.limit} try-ons per month</s-text>
                {activePlan === plan.key ? (
                  <s-text>Current plan</s-text>
                ) : (
                  <s-button onClick={() => subscribe(plan.key)}>
                    {activePlan ? "Switch to this plan" : "Subscribe"}
                  </s-button>
                )}
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="How it works">
        <s-paragraph>
          Once subscribed, add the "AttyreNow Try-On" block to your product
          pages from the theme editor. Shoppers can then upload a photo and
          see themselves wearing your products.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};