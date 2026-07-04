console.log("[StorageSync SW] Service Worker 已启动");chrome.runtime.onMessage.addListener((e,o,r)=>(console.log("[StorageSync SW] 收到消息:",e),r({success:!1,error:"功能尚未实现"}),!0));
