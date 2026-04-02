const site = new URLSearchParams(location.search).get("site");
if (site) {
  const badge = document.getElementById("siteBadge");
  badge.textContent = site;
  badge.style.display = "block";
}
