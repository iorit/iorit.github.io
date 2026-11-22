/* ============================================================
   文章左侧悬浮目录：滚动时高亮当前小节
   只依赖原生 API，无第三方库
   结构见 layouts/partials/toc_sidebar.html
   ============================================================ */
(function () {
    "use strict";

    var sidebar = document.querySelector(".toc-sidebar");
    if (!sidebar) return;

    var links = [].slice.call(sidebar.querySelectorAll('a[href^="#"]'));
    if (!links.length) return;

    var items = [];
    links.forEach(function (link) {
        var id = link.getAttribute("href").slice(1);
        try {
            id = decodeURIComponent(id);
        } catch (e) {}
        var el = document.getElementById(id);
        if (el) items.push({ link: link, el: el });
    });
    if (!items.length) return;

    var wide = window.matchMedia("(min-width: 1400px)");
    var current = null;
    var ticking = false;
    var OFFSET = 120; // 触发线：标题进入视口上方 120px 以内就算「当前小节」

    function setActive(item) {
        if (item === current) return;
        if (current) current.link.classList.remove("is-active");
        current = item;
        if (current) current.link.classList.add("is-active");
    }

    function update() {
        ticking = false;
        if (!wide.matches) {
            setActive(null);
            return;
        }

        var active = null;
        for (var i = 0; i < items.length; i++) {
            if (items[i].el.getBoundingClientRect().top - OFFSET <= 0) {
                active = items[i];
            } else {
                break; // items 是文档顺序，后面不可能再命中
            }
        }

        // 滚到底部时强制高亮最后一个小节
        if (window.innerHeight + window.pageYOffset >= document.documentElement.scrollHeight - 2) {
            active = items[items.length - 1];
        }

        setActive(active);
    }

    function schedule() {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(update);
    }

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("load", schedule);
    window.addEventListener("hashchange", schedule);
    if (wide.addEventListener) wide.addEventListener("change", schedule);
    else if (wide.addListener) wide.addListener(schedule);

    update();
})();
