const menuToggle = document.getElementById("menuToggle");
const nav = document.getElementById("navLinks");
menuToggle.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(open));
});
nav.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
  nav.classList.remove("open"); menuToggle.setAttribute("aria-expanded", "false");
}));
async function copyText(text, target, message) {
  try { await navigator.clipboard.writeText(text); target.textContent = message; }
  catch { target.textContent = "Clipboard blocked by browser; select and copy the command/text manually."; }
  setTimeout(() => target.textContent = "", 3500);
}
document.getElementById("copyDeploy").addEventListener("click", () => copyText(".\\deploy.ps1", document.getElementById("deployToast"), "Copied: .\\deploy.ps1"));
document.getElementById("copyPolicy").addEventListener("click", () => copyText("Allow s3:GetObject to cloudfront.amazonaws.com and restrict it with AWS:SourceArn to the intended CloudFront distribution.", document.getElementById("policyToast"), "Copied the key policy idea."));
if ("IntersectionObserver" in window) {
  const targets = ["overview", "architecture", "journey", "security", "deployment", "roadmap"].map(id => document.getElementById(id)).filter(Boolean);
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    nav.querySelectorAll("a").forEach(link => link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`));
  }), { rootMargin: "-20% 0px -70% 0px" });
  targets.forEach(section => observer.observe(section));
}
