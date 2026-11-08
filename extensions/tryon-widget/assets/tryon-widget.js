document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".attyrenow-tryon").forEach(setupWidget);
});

function setupWidget(root) {
  const openBtn = root.querySelector(".attyrenow-tryon__open-btn");
  const closeBtn = root.querySelector(".attyrenow-tryon__close-btn");
  const panel = root.querySelector(".attyrenow-tryon__panel");
  const fileInput = root.querySelector(".attyrenow-tryon__file-input");
  const cameraBtn = root.querySelector(".attyrenow-tryon__camera-btn");
  const choices = root.querySelector(".attyrenow-tryon__choices");
  const requirements = root.querySelector(".attyrenow-tryon__requirements");
  const changeBtn = root.querySelector(".attyrenow-tryon__change-btn");
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

  // Used by both "upload" and "take photo"
  function setPhoto(file) {
    uploadedFile = file;

    if (uploadedFile) {
      previewImg.src = URL.createObjectURL(uploadedFile);
      preview.hidden = false;
      choices.hidden = true;
      requirements.hidden = true;
      generateBtn.disabled = false;
    } else {
      preview.hidden = true;
      choices.hidden = false;
      requirements.hidden = false;
      generateBtn.disabled = true;
    }
  }

  fileInput.addEventListener("change", () => {
    setPhoto(fileInput.files?.[0] ?? null);
  });

  if (changeBtn) {
    changeBtn.addEventListener("click", () => {
      fileInput.value = "";
      resultBox.hidden = true;
      status.textContent = "";
      setPhoto(null);
    });
  }

  if (cameraBtn) {
    // No camera support (very old browsers): show only the upload card
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraBtn.hidden = true;
      choices.classList.add("is-single");
    } else {
      cameraBtn.addEventListener("click", () => {
        openCameraScreen(setPhoto);
      });
    }
  }

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

// ---------------------------------------------------------------
// Camera screen: self-timer, flip camera, retake
// ---------------------------------------------------------------
function openCameraScreen(onUse) {
  const overlay = document.createElement("div");
  overlay.className = "attyrenow-camera";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Take your photo");
  overlay.innerHTML = `
    <div class="attyrenow-camera__top">
      <span class="attyrenow-camera__title">Take your photo</span>
      <button type="button" class="attyrenow-camera__close" aria-label="Close camera">&times;</button>
    </div>
    <div class="attyrenow-camera__stage">
      <video class="attyrenow-camera__video" playsinline muted></video>
      <img class="attyrenow-camera__shot" alt="Your photo" hidden>
      <div class="attyrenow-camera__count" hidden></div>
      <p class="attyrenow-camera__error" hidden></p>
    </div>
    <div class="attyrenow-camera__controls">
      <div class="attyrenow-camera__row" data-mode="live">
        <div class="attyrenow-camera__timer" role="group" aria-label="Timer length">
          <button type="button" data-delay="5" aria-pressed="false">5s</button>
          <button type="button" data-delay="10" aria-pressed="true" class="is-active">10s</button>
        </div>
        <button type="button" class="attyrenow-camera__start">Start timer</button>
        <button type="button" class="attyrenow-camera__flip" aria-label="Switch camera">🔄</button>
      </div>
      <div class="attyrenow-camera__row" data-mode="counting" hidden>
        <button type="button" class="attyrenow-camera__cancel">Cancel</button>
      </div>
      <div class="attyrenow-camera__row" data-mode="review" hidden>
        <button type="button" class="attyrenow-camera__retake">Retake</button>
        <button type="button" class="attyrenow-camera__use">Use this photo</button>
      </div>
    </div>
  `;

  const $ = (sel) => overlay.querySelector(sel);
  const video = $(".attyrenow-camera__video");
  const shotImg = $(".attyrenow-camera__shot");
  const countEl = $(".attyrenow-camera__count");
  const errorEl = $(".attyrenow-camera__error");
  const titleEl = $(".attyrenow-camera__title");
  const startBtn = $(".attyrenow-camera__start");
  const timerBtns = overlay.querySelectorAll(".attyrenow-camera__timer button");

  let facing = "user";
  let delay = 10;
  let stream = null;
  let countdownId = null;
  let shotBlob = null;
  let shotUrl = null;
  let closed = false;

  function showMode(mode) {
    overlay.querySelectorAll(".attyrenow-camera__row").forEach((row) => {
      row.hidden = row.dataset.mode !== mode;
    });
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
    startBtn.disabled = true;
  }

  async function startStream() {
    stopStream();
    errorEl.hidden = true;
    startBtn.disabled = false;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError("Your browser can't open the camera here. Please upload a photo instead.");
      return;
    }

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      if (closed) {
        newStream.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = newStream;
      video.srcObject = stream;
      video.style.transform = facing === "user" ? "scaleX(-1)" : "";
      video.play().catch(() => {});
    } catch (err) {
      if (closed) return;
      const name = err && err.name;
      if (name === "NotAllowedError") {
        showError("Camera access is blocked. Allow it in your browser settings, or upload a photo instead.");
      } else if (name === "NotFoundError") {
        showError("No camera found. Please upload a photo instead.");
      } else {
        showError("Couldn't start the camera. Please upload a photo instead.");
      }
    }
  }

  function clearCountdown() {
    if (countdownId) {
      clearTimeout(countdownId);
      countdownId = null;
    }
    countEl.hidden = true;
  }

  function takePhoto() {
    if (!video.videoWidth) {
      showMode("live");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob || closed) {
          showMode("live");
          return;
        }
        shotBlob = blob;
        shotUrl = URL.createObjectURL(blob);
        shotImg.src = shotUrl;
        shotImg.hidden = false;
        video.hidden = true;
        stopStream();
        titleEl.textContent = "Happy with this photo?";
        showMode("review");
      },
      "image/jpeg",
      0.92
    );
  }

  function startCountdown() {
    let remaining = delay;
    showMode("counting");
    const tick = () => {
      if (remaining === 0) {
        countEl.hidden = true;
        countdownId = null;
        takePhoto();
        return;
      }
      countEl.textContent = String(remaining);
      countEl.hidden = false;
      remaining -= 1;
      countdownId = setTimeout(tick, 1000);
    };
    tick();
  }

  function retake() {
    if (shotUrl) URL.revokeObjectURL(shotUrl);
    shotUrl = null;
    shotBlob = null;
    shotImg.hidden = true;
    video.hidden = false;
    titleEl.textContent = "Take your photo";
    showMode("live");
    startStream();
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  function close() {
    if (closed) return;
    closed = true;
    clearCountdown();
    stopStream();
    if (shotUrl) URL.revokeObjectURL(shotUrl);
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = previousOverflow;
    overlay.remove();
  }

  $(".attyrenow-camera__close").addEventListener("click", close);
  $(".attyrenow-camera__start").addEventListener("click", startCountdown);
  $(".attyrenow-camera__cancel").addEventListener("click", () => {
    clearCountdown();
    showMode("live");
  });
  $(".attyrenow-camera__flip").addEventListener("click", () => {
    facing = facing === "user" ? "environment" : "user";
    startStream();
  });
  $(".attyrenow-camera__retake").addEventListener("click", retake);
  $(".attyrenow-camera__use").addEventListener("click", () => {
    if (!shotBlob) return;
    const file = new File([shotBlob], `camera-photo-${Date.now()}.jpg`, { type: "image/jpeg" });
    onUse(file);
    close();
  });
  timerBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      delay = Number(btn.dataset.delay);
      timerBtns.forEach((b) => {
        const active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-pressed", active ? "true" : "false");
      });
    });
  });

  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  startStream();
}
