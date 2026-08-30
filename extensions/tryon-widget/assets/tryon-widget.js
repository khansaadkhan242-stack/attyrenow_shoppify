document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".attyrenow-tryon").forEach(setupWidget);
});

function setupWidget(root) {
  const openBtn = root.querySelector(".attyrenow-tryon__open-btn");
  const closeBtn = root.querySelector(".attyrenow-tryon__close-btn");
  const panel = root.querySelector(".attyrenow-tryon__panel");
  const fileInput = root.querySelector(".attyrenow-tryon__file-input");
  const preview = root.querySelector(".attyrenow-tryon__preview");
  const previewImg = root.querySelector(".attyrenow-tryon__preview-img");
  const generateBtn = root.querySelector(".attyrenow-tryon__generate-btn");
  const resultBox = root.querySelector(".attyrenow-tryon__result");
  const resultImg = root.querySelector(".attyrenow-tryon__result-img");
  const status = root.querySelector(".attyrenow-tryon__status");

  let uploadedFile = null;
  const productImageUrl = root.dataset.productImage;
  const shopDomain = window.Shopify?.shop || window.location.hostname;

  openBtn.addEventListener("click", () => {
    panel.hidden = false;
  });

  closeBtn.addEventListener("click", () => {
    panel.hidden = true;
  });

  fileInput.addEventListener("change", () => {
    uploadedFile = fileInput.files?.[0] ?? null;

    if (uploadedFile) {
      previewImg.src = URL.createObjectURL(uploadedFile);
      preview.hidden = false;
      generateBtn.disabled = false;
    } else {
      preview.hidden = true;
      generateBtn.disabled = true;
    }
  });

  generateBtn.addEventListener("click", async () => {
    if (!uploadedFile) return;

    status.textContent = "Generating... this can take a few seconds.";
    generateBtn.disabled = true;
    resultBox.hidden = true;

    try {
      const formData = new FormData();
      formData.append("humanImage", uploadedFile);
      formData.append("garmentImageUrl", productImageUrl);

      const appUrl = document.currentScript?.src
        ? new URL(document.currentScript.src).origin
        : window.location.origin;

      const response = await fetch(
        `/apps/attyrenow/api/tryon?shop=${encodeURIComponent(shopDomain)}`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
          },
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        status.textContent = data.error || "Something went wrong.";
        generateBtn.disabled = false;
        return;
      }

      resultImg.src = data.resultImage;
      resultBox.hidden = false;
      status.textContent = `Done! ${data.remaining} try-ons left this month.`;
    } catch (err) {
      status.textContent = "Network error. Please try again.";
    } finally {
      generateBtn.disabled = false;
    }
  });
}