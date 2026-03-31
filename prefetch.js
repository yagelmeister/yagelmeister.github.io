(function(){
  var config = window.YAGEL_PREFETCH_CONFIG;
  if(!config || !Array.isArray(config.pages) || !config.pages.length) return;

  var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  var effectiveType = connection && connection.effectiveType || "";
  var saveData = !!(connection && connection.saveData);
  var disableAllWarmup = saveData || /(^|-)2g/.test(effectiveType);
  var disableMediaWarmup = disableAllWarmup || effectiveType === "3g";
  var prefetched = new Set();
  var primed = new Set();
  var pageTextCache = new Map();
  var warmedDocs = new Set();
  var warmedMedia = new Set();
  var keepAlive = [];
  var head = document.head || document.getElementsByTagName("head")[0];

  function runWhenIdle(fn, delay){
    delay = delay || 0;
    if("requestIdleCallback" in window){
      window.requestIdleCallback(function(){
        window.setTimeout(fn, delay);
      }, { timeout: 2400 + delay });
      return;
    }
    window.setTimeout(fn, 1200 + delay);
  }

  function afterLoad(fn){
    if(document.readyState === "complete"){
      fn();
      return;
    }
    window.addEventListener("load", fn, { once:true });
  }

  function toAbsolute(url, base){
    try{
      return new URL(url, base || window.location.href).href;
    }catch(_err){
      return "";
    }
  }

  function sameOrigin(url){
    try{
      return new URL(url, window.location.href).origin === window.location.origin;
    }catch(_err){
      return false;
    }
  }

  function prefetch(url, asType){
    var absolute = toAbsolute(url);
    if(!absolute || !sameOrigin(absolute) || prefetched.has(absolute) || !head) return;

    var link = document.createElement("link");
    link.rel = "prefetch";
    link.href = absolute;
    if(asType) link.as = asType;
    head.appendChild(link);
    prefetched.add(absolute);
  }

  function prime(url, asType){
    var absolute = toAbsolute(url);
    if(!absolute || !sameOrigin(absolute) || primed.has(absolute)) return;
    primed.add(absolute);

    if(asType === "image"){
      var img = new Image();
      img.decoding = "async";
      img.fetchPriority = "high";
      img.src = absolute;
      keepAlive.push(img);
      return;
    }

    if(asType === "video"){
      var video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.src = absolute;
      video.load();
      keepAlive.push(video);
      return;
    }

    fetch(absolute, { credentials:"same-origin" }).catch(function(){});
  }

  function fetchText(url){
    var absolute = toAbsolute(url);
    if(!absolute || !sameOrigin(absolute)) return Promise.resolve("");
    if(!pageTextCache.has(absolute)){
      pageTextCache.set(absolute, fetch(absolute, { credentials:"same-origin" })
        .then(function(response){
          return response.ok ? response.text() : "";
        })
        .catch(function(){
          return "";
        }));
    }
    return pageTextCache.get(absolute);
  }

  function inferAsType(url){
    var clean = url.split("#")[0].split("?")[0].toLowerCase();
    if(clean.endsWith(".mp4") || clean.endsWith(".webm")) return "video";
    if(clean.endsWith(".webp") || clean.endsWith(".png") || clean.endsWith(".jpg") || clean.endsWith(".jpeg") || clean.endsWith(".gif") || clean.endsWith(".svg")) return "image";
    if(clean.endsWith(".pdf")) return "fetch";
    if(clean.endsWith(".html")) return "document";
    return "";
  }

  function extractGalleryAssets(pageText, rule){
    var galleryLimit = Math.max(0, rule.warmGalleries || 0);
    var mediaPerGallery = Math.max(1, rule.mediaPerGallery || 1);
    if(!galleryLimit) return [];

    var results = [];
    var seen = new Set();
    var photosRegex = /photos\s*:\s*\[([\s\S]*?)\]/g;
    var assetRegex = /["']((?:images|fonts)\/[^"'`<>]+?\.(?:webp|png|jpe?g|gif|svg|mp4|webm))["']/g;
    var galleryMatch;
    var galleryCount = 0;

    while((galleryMatch = photosRegex.exec(pageText)) && galleryCount < galleryLimit){
      var galleryAssets = [];
      var assetMatch;
      assetRegex.lastIndex = 0;

      while((assetMatch = assetRegex.exec(galleryMatch[1]))){
        var asset = assetMatch[1];
        if(seen.has(asset)) continue;
        seen.add(asset);
        galleryAssets.push(asset);
        if(galleryAssets.length >= mediaPerGallery) break;
      }

      if(galleryAssets.length){
        results = results.concat(galleryAssets);
        galleryCount += 1;
      }
    }

    return results;
  }

  function warmRule(rule, mode){
    if(!rule || !rule.href || disableAllWarmup) return;
    mode = mode || "idle";

    var pageUrl = toAbsolute(rule.href);
    if(!pageUrl) return;

    if(!warmedDocs.has(pageUrl)){
      warmedDocs.add(pageUrl);
      prefetch(pageUrl, "document");
    }

    if(mode === "intent"){
      fetchText(pageUrl);
    }

    if(disableMediaWarmup || !rule.warmGalleries) return;
    if(mode !== "intent" && warmedMedia.has(pageUrl)) return;
    warmedMedia.add(pageUrl);

    fetchText(pageUrl).then(function(pageText){
      extractGalleryAssets(pageText, rule).forEach(function(asset){
        var absoluteAsset = toAbsolute(asset, pageUrl);
        var asType = inferAsType(asset);
        if(mode === "intent"){
          prime(absoluteAsset, asType);
          return;
        }
        prefetch(absoluteAsset, asType);
      });
    });
  }

  function bindIntent(rule){
    document.querySelectorAll('a[href="' + rule.href + '"]').forEach(function(anchor){
      var trigger = function(){
        warmRule(rule, "intent");
      };

      anchor.addEventListener("mouseenter", trigger, { once:true, passive:true });
      anchor.addEventListener("focus", trigger, { once:true, passive:true });
      anchor.addEventListener("touchstart", trigger, { once:true, passive:true });
    });
  }

  config.pages.forEach(bindIntent);

  afterLoad(function(){
    config.pages.forEach(function(rule, index){
      runWhenIdle(function(){
        warmRule(rule, "idle");
      }, index * 500);
    });
  });
})();
