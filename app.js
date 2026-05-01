const state = {
  products: [],
  cart: JSON.parse(localStorage.getItem("storeCart") || "[]"),
  currentFilter: "all",
  user: null,
  users: [],
  orders: [],
  siteMessage: "",
  userToken: localStorage.getItem("userToken") || "",
  adminToken: localStorage.getItem("adminToken") || "",
};

const productGrid = document.querySelector("#productGrid");
const cartDrawer = document.querySelector("#cartDrawer");
const cartItems = document.querySelector("#cartItems");
const cartCount = document.querySelector("#cartCount");
const cartSubtotal = document.querySelector("#cartSubtotal");
const checkoutTotal = document.querySelector("#checkoutTotal");
const summaryItems = document.querySelector("#summaryItems");
const summarySubtotal = document.querySelector("#summarySubtotal");
const summaryDelivery = document.querySelector("#summaryDelivery");
const summaryDiscount = document.querySelector("#summaryDiscount");
const checkoutItems = document.querySelector("#checkoutItems");
const toast = document.querySelector("#toast");
const loginModal = document.querySelector("#loginModal");
const loginStatus = document.querySelector("#loginStatus");
const paymentNote = document.querySelector("#paymentNote");
const siteAnnouncement = document.querySelector("#siteAnnouncement");
const signedInLabel = document.querySelector("#signedInLabel");
const checkoutName = document.querySelector("#checkoutName");
const checkoutPhone = document.querySelector("#checkoutPhone");
const checkoutAddress = document.querySelector("#checkoutAddress");
const adminLogin = document.querySelector("#adminLogin");
const adminPanel = document.querySelector("#adminPanel");
const productForm = document.querySelector("#productForm");

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 0,
  }).format(value);

const api = async (url, options = {}) => {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
};

const showToast = (message) => {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("show"), 2800);
};

const saveCart = () => localStorage.setItem("storeCart", JSON.stringify(state.cart));
const cartTotal = () => state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
const cartQuantity = () => state.cart.reduce((sum, item) => sum + item.quantity, 0);
const deliveryFee = () => (cartTotal() > 0 && cartTotal() < 7500 ? 250 : 0);
const discountTotal = () =>
  state.cart.reduce((sum, item) => {
    const percent = Number(String(item.offer || "").match(/(\d+)%/)?.[1] || 0);
    return sum + item.price * item.quantity * (percent / 100);
  }, 0);
const payableTotal = () => Math.max(cartTotal() + deliveryFee() - discountTotal(), 0);
const isBlocked = () => Boolean(state.user?.blocked);

const renderAnnouncement = () => {
  siteAnnouncement.hidden = !state.siteMessage;
  siteAnnouncement.textContent = state.siteMessage || "";
  const messageBox = document.querySelector("#adminMessage");
  if (messageBox) messageBox.value = state.siteMessage || "";
};

const renderProducts = () => {
  const visibleProducts = state.products.filter((product) => state.currentFilter === "all" || product.category === state.currentFilter);
  productGrid.innerHTML = visibleProducts
    .map(
      (product) => `
        <article class="product-card ${product.soldOut ? "sold-out" : ""}">
          <div class="product-image">
            ${product.offer ? `<span class="product-badge">${product.offer}</span>` : ""}
            ${product.soldOut ? '<span class="soldout-badge">Sold out</span>' : ""}
            <img src="${product.image}" alt="${product.name}" loading="lazy" />
          </div>
          <div class="product-info">
            <div class="product-meta">
              <div>
                <h3>${product.name}</h3>
                <p>${product.description}</p>
              </div>
              <span class="price">${formatCurrency(product.price)}</span>
            </div>
            <div class="product-actions">
              <select class="size-select" aria-label="Choose size for ${product.name}" data-size-for="${product.id}" ${product.soldOut ? "disabled" : ""}>
                <option>S</option>
                <option selected>M</option>
                <option>L</option>
                <option>XL</option>
              </select>
              <button class="add-button" type="button" data-product-id="${product.id}" ${product.soldOut ? "disabled" : ""}>
                ${product.soldOut ? "Sold out" : "Add"}
              </button>
            </div>
          </div>
        </article>
      `
    )
    .join("");
};

const renderCart = () => {
  cartCount.textContent = cartQuantity();
  cartSubtotal.textContent = formatCurrency(cartTotal());
  checkoutTotal.textContent = formatCurrency(payableTotal());
  summaryItems.textContent = cartQuantity();
  summarySubtotal.textContent = formatCurrency(cartTotal());
  summaryDelivery.textContent = formatCurrency(deliveryFee());
  summaryDiscount.textContent = `-${formatCurrency(discountTotal())}`;

  if (!state.cart.length) {
    cartItems.innerHTML = '<p class="empty-cart">Your cart is empty. Add a few pieces you like.</p>';
    checkoutItems.innerHTML = '<p class="empty-cart compact">No package selected yet.</p>';
    return;
  }

  cartItems.innerHTML = state.cart
    .map(
      (item) => `
        <article class="cart-item">
          <img src="${item.image}" alt="${item.name}" />
          <div>
            <h3>${item.name}</h3>
            <p>Size ${item.size} - ${formatCurrency(item.price)}</p>
            <div class="cart-line">
              <div class="quantity" aria-label="Quantity for ${item.name}">
                <button class="quantity-button" type="button" data-action="decrease" data-key="${item.key}">-</button>
                <strong>${item.quantity}</strong>
                <button class="quantity-button" type="button" data-action="increase" data-key="${item.key}">+</button>
              </div>
              <button class="remove-button" type="button" data-action="remove" data-key="${item.key}">Remove</button>
            </div>
          </div>
        </article>
      `
    )
    .join("");

  checkoutItems.innerHTML = state.cart
    .map(
      (item) => `
        <article class="checkout-item">
          <img src="${item.image}" alt="${item.name}" />
          <div>
            <strong>${item.name}</strong>
            <span>Size ${item.size} x ${item.quantity}</span>
          </div>
          <b>${formatCurrency(item.price * item.quantity)}</b>
        </article>
      `
    )
    .join("");
};

const fillSavedAddress = () => {
  if (!state.user?.email) {
    signedInLabel.textContent = "Sign in to save this address for next time.";
    return;
  }
  const address = state.user.addresses?.[0];
  signedInLabel.textContent = isBlocked()
    ? "This account is blocked. Checkout is disabled."
    : `Signed in as ${state.user.email}. Address will be saved.`;
  if (address) {
    checkoutName.value = address.name || "";
    checkoutPhone.value = address.phone || "";
    checkoutAddress.value = address.address || "";
  }
};

const setDrawerOpen = (isOpen) => {
  cartDrawer.classList.toggle("open", isOpen);
  cartDrawer.setAttribute("aria-hidden", String(!isOpen));
};

const setLoginOpen = (isOpen) => {
  loginModal.classList.toggle("open", isOpen);
  loginModal.setAttribute("aria-hidden", String(!isOpen));
};

const updatePaymentNote = () => {
  const payment = document.querySelector('input[name="payment"]:checked')?.value || "JazzCash";
  const notes = {
    JazzCash: "Order will be created as payment pending. Connect JazzCash merchant credentials for live charging.",
    EasyPaisa: "Order will be created as payment pending. Connect EasyPaisa merchant credentials for live charging.",
    "Bank Transfer": "Order will be created as payment pending. Share bank details after confirmation.",
  };
  paymentNote.textContent = notes[payment];
};

const loadStore = async () => {
  const data = await api("/api/store");
  state.products = data.products;
  state.siteMessage = data.siteMessage;
  renderAnnouncement();
  renderProducts();
  renderCart();
};

const loadMe = async () => {
  if (!state.userToken) return;
  try {
    const data = await api("/api/me", { token: state.userToken });
    state.user = data.user;
    loginStatus.textContent = state.user ? `Signed in as ${state.user.name || state.user.email}.` : "Not signed in.";
    fillSavedAddress();
  } catch (error) {
    localStorage.removeItem("userToken");
    state.userToken = "";
    state.user = null;
  }
};

const loadAdmin = async () => {
  if (!state.adminToken) return;
  try {
    const data = await api("/api/admin", { token: state.adminToken });
    state.products = data.products;
    state.orders = data.orders;
    state.users = data.users;
    state.siteMessage = data.siteMessage;
    adminLogin.hidden = true;
    adminPanel.hidden = false;
    renderAnnouncement();
    renderProducts();
    renderAdminProducts();
    renderAdminOrders();
    renderAdminUsers();
  } catch (error) {
    localStorage.removeItem("adminToken");
    state.adminToken = "";
    adminLogin.hidden = false;
    adminPanel.hidden = true;
  }
};

const addToCart = (productId) => {
  if (isBlocked()) return showToast("This account is blocked. Please contact the store.");
  const product = state.products.find((item) => item.id === productId);
  if (!product || product.soldOut) return showToast("This product is sold out.");
  const size = document.querySelector(`[data-size-for="${productId}"]`).value;
  const key = `${productId}-${size}`;
  const existing = state.cart.find((item) => item.key === key);
  if (existing) existing.quantity += 1;
  else state.cart.push({ ...product, size, key, quantity: 1 });
  saveCart();
  renderCart();
  showToast(`${product.name} added to cart.`);
};

const updateCartItem = (key, action) => {
  const item = state.cart.find((cartItem) => cartItem.key === key);
  if (!item) return;
  if (action === "increase") item.quantity += 1;
  if (action === "decrease") item.quantity -= 1;
  if (action === "remove" || item.quantity <= 0) {
    state.cart = state.cart.filter((cartItem) => cartItem.key !== key);
  }
  saveCart();
  renderCart();
};

const completeLogin = (data) => {
  state.userToken = data.token;
  state.user = data.user;
  localStorage.setItem("userToken", data.token);
  loginStatus.textContent = `Signed in as ${state.user.name || state.user.email}.`;
  fillSavedAddress();
  setLoginOpen(false);
  showToast(isBlocked() ? "This account is blocked by admin." : "Signed in.");
};

window.handleGoogleCredential = async (response) => {
  try {
    completeLogin(await api("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential: response.credential }),
    }));
  } catch (error) {
    loginStatus.textContent = error.message;
  }
};

const renderAdminProducts = () => {
  document.querySelector("#adminProducts").innerHTML = state.products
    .map(
      (product) => `
        <article class="admin-card">
          <img src="${product.image}" alt="${product.name}" />
          <div>
            <strong>${product.name}</strong>
            <span>${product.category} - ${formatCurrency(product.price)}</span>
            <span>${product.offer || "No offer"} ${product.soldOut ? "- Sold out" : ""}</span>
          </div>
          <div class="admin-actions">
            <button type="button" data-admin-action="edit-product" data-id="${product.id}">Edit</button>
            <button type="button" data-admin-action="remove-product" data-id="${product.id}">Remove</button>
          </div>
        </article>
      `
    )
    .join("");
};

const renderAdminOrders = () => {
  document.querySelector("#adminOrders").innerHTML = state.orders.length
    ? state.orders
        .map(
          (order) => `
            <article class="admin-card stacked">
              <div>
                <strong>${order.id} - ${formatCurrency(order.total)}</strong>
                <span>${order.customer.name} | ${order.customer.phone} | ${order.payment} | ${order.paymentStatus}</span>
                <span>${order.customer.address}</span>
                <span>${order.items.map((item) => `${item.name} x ${item.quantity}`).join(", ")}</span>
              </div>
              <select data-admin-action="order-status" data-id="${order.id}">
                <option ${order.status === "Pending" ? "selected" : ""}>Pending</option>
                <option ${order.status === "Packed" ? "selected" : ""}>Packed</option>
                <option ${order.status === "Shipped" ? "selected" : ""}>Shipped</option>
                <option ${order.status === "Cancelled" ? "selected" : ""}>Cancelled</option>
              </select>
            </article>
          `
        )
        .join("")
    : '<p class="empty-cart compact">No orders yet.</p>';
};

const renderAdminUsers = () => {
  document.querySelector("#adminUsers").innerHTML = state.users.length
    ? state.users
        .map(
          (user) => `
            <article class="admin-card stacked">
              <div>
                <strong>${user.name || user.email}</strong>
                <span>${user.email} - ${user.provider || "Email"}</span>
                <span>${user.addresses?.[0]?.address || "No saved address"}</span>
              </div>
              <button type="button" data-admin-action="toggle-user" data-email="${user.email}" data-blocked="${user.blocked}">
                ${user.blocked ? "Unblock" : "Block"}
              </button>
            </article>
          `
        )
        .join("")
    : '<p class="empty-cart compact">No users yet.</p>';
};

productGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-product-id]");
  if (button) addToCart(button.dataset.productId);
});

document.querySelectorAll(".filter").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((filter) => filter.classList.remove("active"));
    button.classList.add("active");
    state.currentFilter = button.dataset.filter;
    renderProducts();
  });
});

cartItems.addEventListener("click", (event) => {
  const control = event.target.closest("[data-action]");
  if (control) updateCartItem(control.dataset.key, control.dataset.action);
});

document.querySelector("#cartOpen").addEventListener("click", () => setDrawerOpen(true));
document.querySelector("#cartClose").addEventListener("click", () => setDrawerOpen(false));
document.querySelector("#checkoutLink").addEventListener("click", () => setDrawerOpen(false));
cartDrawer.addEventListener("click", (event) => {
  if (event.target === cartDrawer) setDrawerOpen(false);
});

document.querySelector("#loginOpen").addEventListener("click", () => setLoginOpen(true));
document.querySelector("#loginClose").addEventListener("click", () => setLoginOpen(false));
loginModal.addEventListener("click", (event) => {
  if (event.target === loginModal) setLoginOpen(false);
});

document.querySelector("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    completeLogin(await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    }));
    await loadAdmin();
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#saveAddressButton").addEventListener("click", async () => {
  if (!state.userToken) {
    showToast("Please sign in before saving an address.");
    setLoginOpen(true);
    return;
  }
  try {
    const data = await api("/api/addresses", {
      method: "POST",
      token: state.userToken,
      body: JSON.stringify({
        name: checkoutName.value,
        phone: checkoutPhone.value,
        address: checkoutAddress.value,
      }),
    });
    state.user = data.user;
    fillSavedAddress();
    await loadAdmin();
    showToast("Address saved on server.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#checkoutForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isBlocked()) return showToast("This account is blocked. Checkout is disabled.");
  if (!state.cart.length) return showToast("Add at least one item before checkout.");
  const form = new FormData(event.currentTarget);
  try {
    const data = await api("/api/orders", {
      method: "POST",
      token: state.userToken,
      body: JSON.stringify({
        customer: {
          name: form.get("name"),
          phone: form.get("phone"),
          address: form.get("address"),
          email: state.user?.email || "guest",
        },
        payment: form.get("payment"),
        items: state.cart.map((item) => ({ id: item.id, size: item.size, quantity: item.quantity })),
      }),
    });
    state.user = data.user || state.user;
    state.cart = [];
    saveCart();
    renderCart();
    fillSavedAddress();
    await loadAdmin();
    showToast(`Order ${data.order.id} saved on server. Total ${formatCurrency(data.order.total)}.`);
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#paymentOptions").addEventListener("change", updatePaymentNote);

document.querySelector("#adminLoginButton").addEventListener("click", async () => {
  try {
    const data = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ passcode: document.querySelector("#adminPasscode").value }),
    });
    state.adminToken = data.token;
    localStorage.setItem("adminToken", data.token);
    await loadAdmin();
    showToast("Admin panel opened.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelectorAll(".admin-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".admin-tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".admin-view").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`[data-admin-view="${tab.dataset.adminTab}"]`).classList.add("active");
  });
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(productForm);
  const product = {
    id: form.get("id"),
    name: form.get("name"),
    category: form.get("category"),
    description: form.get("description"),
    price: Number(form.get("price")),
    image: form.get("image"),
    offer: form.get("offer"),
    soldOut: form.get("soldOut") === "on",
  };
  try {
    await api("/api/admin/products", { method: "POST", token: state.adminToken, body: JSON.stringify(product) });
    productForm.reset();
    productForm.elements.id.value = "";
    await loadAdmin();
    renderCart();
    showToast("Product saved on server.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#adminProducts").addEventListener("click", async (event) => {
  const control = event.target.closest("[data-admin-action]");
  if (!control) return;
  const product = state.products.find((item) => item.id === control.dataset.id);
  if (control.dataset.adminAction === "edit-product" && product) {
    productForm.elements.id.value = product.id;
    productForm.elements.name.value = product.name;
    productForm.elements.price.value = product.price;
    productForm.elements.category.value = product.category;
    productForm.elements.image.value = product.image;
    productForm.elements.description.value = product.description;
    productForm.elements.offer.value = product.offer || "";
    productForm.elements.soldOut.checked = product.soldOut;
    productForm.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  if (control.dataset.adminAction === "remove-product") {
    try {
      await api(`/api/admin/products/${encodeURIComponent(control.dataset.id)}`, { method: "DELETE", token: state.adminToken });
      state.cart = state.cart.filter((item) => item.id !== control.dataset.id);
      saveCart();
      await loadAdmin();
      renderCart();
      showToast("Product removed from server.");
    } catch (error) {
      showToast(error.message);
    }
  }
});

document.querySelector("#adminOrders").addEventListener("change", async (event) => {
  const control = event.target.closest("[data-admin-action='order-status']");
  if (!control) return;
  try {
    await api(`/api/admin/orders/${encodeURIComponent(control.dataset.id)}`, {
      method: "PATCH",
      token: state.adminToken,
      body: JSON.stringify({ status: control.value }),
    });
    await loadAdmin();
    showToast("Order status updated on server.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#adminUsers").addEventListener("click", async (event) => {
  const control = event.target.closest("[data-admin-action='toggle-user']");
  if (!control) return;
  try {
    await api(`/api/admin/users/${encodeURIComponent(control.dataset.email)}`, {
      method: "PATCH",
      token: state.adminToken,
      body: JSON.stringify({ blocked: control.dataset.blocked !== "true" }),
    });
    await loadAdmin();
    await loadMe();
    showToast("User status updated on server.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#messageForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await api("/api/admin/message", {
      method: "PUT",
      token: state.adminToken,
      body: JSON.stringify({ message: new FormData(event.currentTarget).get("message") }),
    });
    state.siteMessage = data.siteMessage;
    renderAnnouncement();
    showToast("Website message published from server.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#clearMessageButton").addEventListener("click", async () => {
  try {
    const data = await api("/api/admin/message", {
      method: "PUT",
      token: state.adminToken,
      body: JSON.stringify({ message: "" }),
    });
    state.siteMessage = data.siteMessage;
    renderAnnouncement();
    showToast("Website message cleared.");
  } catch (error) {
    showToast(error.message);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setDrawerOpen(false);
    setLoginOpen(false);
  }
});

(async function init() {
  try {
    await loadStore();
    await loadMe();
    await loadAdmin();
  } catch (error) {
    showToast(error.message);
  }
  updatePaymentNote();
  fillSavedAddress();
})();
