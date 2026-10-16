// Builds the "Fister VR + FisterQoL" bookmarklet code. Used by tools/build.cjs (default bookmarklet) and inlined into
// the setup page (bookmarklet with your settings). Keep it plain ES5-ish: it is pasted into the page as-is.
//
// payload: base64 of the gzipped FisterQoL bookmarklet build (FisterQoL + the Fister VR layer inside it).
// vrConfig: Fister VR settings from the setup page. applyEachTime: true writes them on every tap (they then win over
// changes made in QoL > VR); false only uses them when this browser has no saved VR settings yet.
//
// FisterQoL has to be in place before the game loads its code, which a bookmark tapped in the headset can't manage.
// So the bookmark restarts the game inside this tab: it freezes the running copy (stops its frame loop, timers, sound,
// network and frees its WebGL context), then writes a fresh copy of the fister.fun home page into a full-window
// same-origin frame with FisterQoL running first. If the game in the frame reloads itself, the frame is rebuilt the
// same way so QoL stays on, at the URL the game went to.
//
// fister.fun's Content-Security-Policy blocks inline scripts (Quest log on 0.9.3: FisterQoL never started in the frame).
// Bookmarks themselves aren't subject to it, but a frame created as about:blank inherits it. So the frame is first
// pointed at a same-origin file served without a policy (robots.txt, favicon, ...), and the home page is written into
// that document, which then has no policy; any policy <meta> tag is left out of the copy. Only the home page gets QoL, and if the game keeps reloading
// itself (3 times in 30 s) the loader stops rebuilding, leaves the game running without QoL and shows a log to copy.
function qolLoader(payload, vrConfig, applyEachTime) {
  var cfg = JSON.stringify(vrConfig || {});
  return '(function(){'
    + 'var P=' + JSON.stringify(payload) + ',C=' + cfg + ',E=' + (applyEachTime ? 'true' : 'false') + ';'
    + 'var W=window,D=document,say=function(t){alert("FisterQoL: "+t);};'
    + 'if(!/(^|\\.)fister\\.fun$/.test(location.hostname)){say("open https://fister.fun first, then tap this bookmark.");return;}'
    + 'if(W.__fisterQolFrame||W.__fisterQolBookmarkletLoading||W.__fisterQolBrowserLoading||W.__fisterQolBrowserReady){say("FisterQoL is already running on this page. Reload the page to start over.");return;}'
    + 'if(typeof DecompressionStream!=="function"){say("this browser is too old (no DecompressionStream). Update the Quest Browser.");return;}'
    + 'W.__fisterQolBookmarkletLoading=true;'
    // VR mode on, and the page's VR settings saved where both Fister VR and QoL > VR read them.
    + 'try{var q=JSON.parse(localStorage.getItem("fister-qol-vr-v1")||"{}");q.enabled=true;'
    + 'if(typeof q.hideCrosshair!=="boolean")q.hideCrosshair=true;if(typeof q.uncapFps!=="boolean")q.uncapFps=true;'
    + 'localStorage.setItem("fister-qol-vr-v1",JSON.stringify(q));'
    + 'var raw=localStorage.getItem("fister-vr-config");'
    + 'if(E||!raw){var s=raw?JSON.parse(raw)||{}:{};for(var k in C){var v=C[k];'
    + 'if(v&&typeof v==="object"&&!Array.isArray(v)&&s[k]&&typeof s[k]==="object"){for(var j in v)s[k][j]=v[j];}else s[k]=v;}'
    + 'localStorage.setItem("fister-vr-config",JSON.stringify(s));}}catch(e){}'
    // A script nonce, in case the site's policy ever needs one.
    + 'var nonce="";try{var ns=D.querySelector("script[nonce]");if(ns)nonce=ns.nonce||ns.getAttribute("nonce")||"";}catch(e){}'
    + 'var fail=function(e){W.__fisterQolBookmarkletLoading=false;say("could not start ("+(e&&e.message||e)+").");};'
    + 'var L=W.__fisterQolLog=[];var add=function(t){L.push(new Date().toISOString().slice(11,19)+" "+String(t).slice(0,500));if(L.length>300)L.shift();};'
    + 'var str=function(a){return [].map.call(a,function(x){return x&&x.stack?x.stack:typeof x==="object"?(function(){try{return JSON.stringify(x);}catch(e){return String(x);}})():String(x);}).join(" ");};'
    + 'add("FisterQoL bookmarklet on "+location.href+" · "+navigator.userAgent);'
    + 'var seen={};var onViolation=function(where){return function(e){var k=where+e.violatedDirective+e.blockedURI;if(seen[k])return;seen[k]=1;add("blocked by the site policy in the "+where+": "+e.violatedDirective+" "+(e.blockedURI||"")+" · policy: "+String(e.originalPolicy||"").slice(0,300));};};'
    + 'D.addEventListener("securitypolicyviolation",onViolation("page"));'
    + 'var home=function(url){return fetch(url||"/",{credentials:"include",cache:"no-store"}).then(function(r){if(!r.ok)throw new Error("home page "+r.status);var p=r.headers.get("content-security-policy");if(p&&!W.__fisterQolPolicyLogged){W.__fisterQolPolicyLogged=1;add("home page policy: "+p.slice(0,400));}return r.text();});};'
    // A same-origin file with no policy and no framing restriction, to host the frame's document.
    + 'var hostUrl=null,hostPath=null;'
    + 'var findHost=function(){var c=["/robots.txt","/favicon.ico","/manifest.json","/site.webmanifest","/manifest.webmanifest","/fister-qol-frame-host"];'
    + 'try{D.querySelectorAll("script[src],link[rel=icon][href],link[rel=manifest][href]").forEach(function(e){var u=new URL(e.src||e.href,location.href);if(u.origin===location.origin)c.push(u.pathname);});}catch(e){}'
    + 'var i=0;var next=function(){if(i>=c.length){add("no same-origin file without a policy found; using a blank frame (scripts may be blocked)");return Promise.resolve(null);}'
    + 'var u=c[i++];return fetch(u,{credentials:"include",cache:"no-store"}).then(function(r){var p=r.headers.get("content-security-policy"),x=r.headers.get("x-frame-options");'
    // Any status is fine (a plain 404 page works too); only a policy or a framing restriction rules a file out.
    + 'if(!p&&!x){add("frame host: "+u+(r.ok?"":" (HTTP "+r.status+")"));return u;}add("skipping "+u+" ("+(p?"has a policy":"x-frame-options "+x)+")");return next();},function(){return next();});};'
    + 'return next();};'
    // Freeze the copy of the game that is already running in this page.
    + 'var freeze=function(){'
    + 'try{W.stop();}catch(e){}'
    + 'try{var hi=W.setTimeout(function(){},0);for(var i=0;i<=hi+200;i++){W.clearTimeout(i);W.clearInterval(i);}}catch(e){}'
    + 'var no=function(){return 0;};W.requestAnimationFrame=no;W.setTimeout=no;W.setInterval=no;'
    + 'try{D.querySelectorAll("audio,video").forEach(function(m){try{m.pause();m.removeAttribute("src");m.load();}catch(e){}});HTMLMediaElement.prototype.play=function(){return Promise.resolve();};}catch(e){}'
    + 'try{D.querySelectorAll("canvas").forEach(function(c){["webgl2","webgl"].forEach(function(t){try{var g=c.getContext(t);var x=g&&g.getExtension("WEBGL_lose_context");if(x)x.loseContext();}catch(e){}});});}catch(e){}'
    + 'var shut=function(c){try{if(c&&c.state!=="closed")c.close();}catch(e){}};'
    + 'try{var AN=W.AudioNode&&AudioNode.prototype,cn=AN&&AN.connect;if(cn)AN.connect=function(){shut(this.context);return arguments[0];};'
    + 'var AS=W.AudioScheduledSourceNode&&AudioScheduledSourceNode.prototype;if(AS)AS.start=function(){shut(this.context);};}catch(e){}'
    // Old sockets close the next time the old game sends or receives on them; streams (WebTransport, fetch bodies) end.
    + 'try{var cl=function(w){try{w.close();}catch(e){}};var WSP=WebSocket.prototype;WSP.send=function(){cl(this);};'
    + 'var dd=Object.getOwnPropertyDescriptor(MessageEvent.prototype,"data");'
    // Any message to the old game (sockets, BroadcastChannel, ports, workers) closes its channel and stops its handler,
    // and so do localStorage change events: a frozen copy reacting to the new one (e.g. "another tab is open") must not
    // make either of them reload.
    + 'Object.defineProperty(MessageEvent.prototype,"data",{configurable:true,get:function(){var t=this.target;if(t&&typeof t.close==="function")cl(t);else if(t&&typeof t.terminate==="function"){try{t.terminate();}catch(e){}}throw new Error("frozen");}});'
    + '["key","newValue","oldValue","storageArea","url"].forEach(function(k){try{Object.defineProperty(StorageEvent.prototype,k,{configurable:true,get:function(){throw new Error("frozen");}});}catch(e){}});'
    + 'W.WebSocket=function(){return{readyState:3,send:function(){},close:function(){},addEventListener:function(){},removeEventListener:function(){}};};'
    + 'var RP=ReadableStreamDefaultReader.prototype;RP.read=function(){try{this.cancel();}catch(e){}return Promise.resolve({done:true,value:undefined});};'
    + 'if(W.RTCPeerConnection)RTCPeerConnection.prototype.addIceCandidate=function(){try{this.close();}catch(e){}return Promise.resolve();};}catch(e){}'
    + '};'
    // Write a fresh home page into the frame, with FisterQoL first in <head>.
    + 'var code=null;'
    + 'W.__fisterQolBoot=function(w){'
    // Keep what the game says while it starts, for the log (Copy log on the stop banner).
    + 'try{w.addEventListener("error",function(e){add("error: "+e.message+" @ "+String(e.filename||"").split("/").pop()+":"+e.lineno);});'
    + 'w.addEventListener("unhandledrejection",function(e){var r=e.reason;add("unhandled rejection: "+(r&&(r.stack||r.message)||r));});'
    + '["error","warn","info"].forEach(function(k){var o=w.console[k];w.console[k]=function(){var t=str(arguments);if(k!=="info"||/fister/i.test(t))add("console."+k+": "+t);return o.apply(this,arguments);};});'
    + 'w.addEventListener("pagehide",function(){lastUrl=w.location.pathname+w.location.search+w.location.hash;add("frame unloading (the game navigated or reloaded) from "+w.location.href);});}catch(e){}'
    // Sites that reload until a service worker controls the page would never stop in the frame, whose document is
    // written by script and may not count as controlled. Report the page's own controller instead.
    + 'try{var top=W.navigator.serviceWorker;if(top&&top.controller&&SWCP(w)){Object.defineProperty(SWCP(w),"controller",{configurable:true,get:function(){return top.controller;}});add("frame uses the page\'s service worker controller");}}catch(e){}'
    // A new service worker taking control makes many sites reload; in the frame that would drop FisterQoL every time.
    + 'try{var SWC=w.ServiceWorkerContainer&&w.ServiceWorkerContainer.prototype;if(SWC){var ae=SWC.addEventListener;'
    + 'SWC.addEventListener=function(t){if(t==="controllerchange"){add("ignored a service-worker controllerchange listener (it would reload the page)");return;}return ae.apply(this,arguments);};'
    + 'Object.defineProperty(SWC,"oncontrollerchange",{configurable:true,get:function(){return null;},set:function(){add("ignored oncontrollerchange");}});}}catch(e){}'
    + 'var d=w.document,el=d.createElement("script");if(nonce)el.nonce=nonce;el.textContent=code;(d.head||d.documentElement).appendChild(el);el.remove();'
    + 'add("FisterQoL started in the frame at "+w.location.href+(w.__fisterQolBrowserLoading?"":" (but it did not hook in)"));};'
    + 'var write=function(f,html){'
    + 'if(nonce)html=html.replace(/\\snonce="[^"]*"/g," nonce=\\""+nonce+"\\"");'
    + 'var tag="<script"+(nonce?" nonce=\\""+nonce+"\\"":"")+">parent.__fisterQolBoot(window)<\\/script>";'
    + 'var m=/<head[^>]*>/i.exec(html);html=m?html.slice(0,m.index+m[0].length)+tag+html.slice(m.index+m[0].length):tag+html;'
    + 'html=html.replace(/<meta[^>]+http-equiv\\s*=\\s*["\']?content-security-policy[^>]*>/gi,"");'
    + 'var d=f.contentDocument;d.open();try{d.addEventListener("securitypolicyviolation",onViolation("frame"));}catch(e){}d.write(html);d.close();f.__fisterQolBooted=true;'
    + 'try{f.contentWindow.focus();}catch(e){}'
    + 'if(!f.contentWindow.__fisterQolBrowserLoading)add("FisterQoL did not start in the frame (see blocked lines above, if any)");};'
    // With a host file, wait for it to load before writing over it.
    + 'var boot=function(f,html){if(hostUrl)f.__fisterQolPending=html;else write(f,html);};'
    + 'var rebuilds=[],lastUrl="/";'
    + 'var SWCP=function(w){return w.ServiceWorkerContainer&&w.ServiceWorkerContainer.prototype;};'
    + 'var pathOf=function(u){try{return new URL(u,location.origin).pathname;}catch(e){return u;}};'
    // Shown when the loader gives up, over the game. No timers: they're switched off in this (frozen) page.
    + 'var banner=function(){var b=D.createElement("div");b.id="fister-qol-stopped";'
    + 'b.style.cssText="position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;width:min(640px,94vw);background:#c0c0c0;color:#000;font:14px Tahoma,Arial,sans-serif;padding:10px 12px;box-shadow:inset -1px -1px #0a0a0a,inset 1px 1px #fff,inset -2px -2px #808080,inset 2px 2px #dfdfdf;";'
    + 'var t=D.createElement("div");t.textContent="FisterQoL stopped: the game kept reloading itself while starting with FisterQoL, so it is running without FisterQoL now (VR mode is off too). Press Copy log and send the text so this can be fixed.";'
    + 'var row=D.createElement("div");row.style.cssText="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap";'
    + 'var btn=function(label,fn){var x=D.createElement("button");x.textContent=label;x.style.cssText="font:bold 14px Tahoma,Arial,sans-serif;padding:6px 14px;background:#c0c0c0;border:0;box-shadow:inset -1px -1px #0a0a0a,inset 1px 1px #fff,inset -2px -2px #808080,inset 2px 2px #dfdfdf;";x.onclick=fn;row.appendChild(x);return x;};'
    + 'var area=D.createElement("textarea");area.readOnly=true;area.style.cssText="display:none;width:100%;height:160px;margin-top:8px;font:11px monospace";'
    + 'btn("Copy log",function(){var text=L.join("\\n");area.value=text;area.style.display="block";var ok=function(){this.textContent="Copied";}.bind(this);'
    + 'try{navigator.clipboard.writeText(text).then(ok,function(){area.select();try{D.execCommand("copy");}catch(e){}});}catch(e){area.select();try{D.execCommand("copy");}catch(e2){}}});'
    + 'btn("Close",function(){b.remove();});'
    + 'b.appendChild(t);b.appendChild(row);b.appendChild(area);D.body.appendChild(b);};'
    + 'var frame=function(){var f=D.createElement("iframe");f.id="fister-qol-frame";if(hostUrl)f.src=hostUrl;'
    + 'f.allow="fullscreen *; xr-spatial-tracking *; autoplay *; microphone *; camera *; clipboard-read *; clipboard-write *; gamepad *; screen-wake-lock *";'
    + 'f.style.cssText="position:fixed;left:0;top:0;width:100%;height:100%;border:0;margin:0;padding:0;z-index:2147483647;background:#000;display:block";'
    + 'f.addEventListener("load",function(){var w;try{w=f.contentWindow;void w.location.href;}catch(e){add("frame host could not be opened");if(f.__fisterQolPending!=null){hostUrl=null;var h0=f.__fisterQolPending;f.__fisterQolPending=null;var n0=frame();f.replaceWith(n0);write(n0,h0);}return;}'
    + 'if(f.__fisterQolPending!=null){var h=f.__fisterQolPending;f.__fisterQolPending=null;write(f,h);return;}'
    + 'try{D.title=w.document.title||D.title;}catch(e){}'
    + 'if(!f.__fisterQolBooted||f.__fisterQolRebuilding)return;'
    + 'var loc=w.location,blank=loc.protocol==="about:"||(!!hostPath&&loc.pathname===hostPath),here=blank?lastUrl:loc.pathname+loc.search+loc.hash;'
    + 'if(w.__fisterQolBrowserLoading){lastUrl=here;add("frame loaded with FisterQoL at "+here);return;}'
    // The game navigated or reloaded inside the frame, so this page has no FisterQoL. A location.reload() in a frame
    // written by script reloads it as about:blank: that means "reload the page that was here".
    + 'add("frame loaded WITHOUT FisterQoL at "+(blank?loc.pathname.replace(/^blank$/,"about:blank")+" (the game reloaded itself at "+here+")":here));'
    + 'try{history.replaceState(null,"",here);}catch(e){}'
    + 'var plain=function(){if(blank){add("loading "+here+" without FisterQoL");try{w.location.replace(here);}catch(e){}}};'
    + 'if(pathOf(here)!=="/"){add("not the home page: FisterQoL only runs on the home page, so this page runs without it");plain();return;}'
    + 'if(W.__fisterQolStopped){plain();return;}'
    + 'var now=Date.now();rebuilds=rebuilds.filter(function(t){return now-t<30000;});'
    + 'if(rebuilds.length>=2){W.__fisterQolStopped=true;add("stopped: the game reloaded itself 3 times in 30 s with FisterQoL; running it without FisterQoL");banner();plain();return;}'
    + 'rebuilds.push(now);f.__fisterQolRebuilding=true;add("restarting the frame with FisterQoL at "+here);'
    // Rebuild at the URL the game went to (e.g. it added a query parameter), not the original one.
    + 'home(here.replace(/#.*$/,"")).then(function(html){var n=frame();f.replaceWith(n);boot(n,html);}).catch(fail);});'
    + 'return f;};'
    + 'var b=atob(P),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);'
    + 'Promise.all([new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))).text(),home(),findHost()]).then(function(r){'
    + 'code=r[0];var html=r[1];hostUrl=r[2];hostPath=hostUrl&&new URL(hostUrl,location.href).pathname;'
    + 'try{if(location.pathname!=="/")history.replaceState(null,"","/"+location.search);}catch(e){}'
    + 'freeze();'
    + 'W.__fisterQolFrame=true;W.__fisterQolBookmarkletLoading=false;'
    + 'var f=frame();D.documentElement.style.overflow="hidden";if(D.body){D.body.replaceChildren(f);}else D.documentElement.appendChild(f);'
    + 'boot(f,html);'
    + '}).catch(fail);'
    + '})();void 0;';
}
if (typeof module !== 'undefined') module.exports = { qolLoader };
