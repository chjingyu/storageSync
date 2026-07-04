(function(){console.log("[StorageSync CS] Content Script 已注入:",window.location.href);chrome.runtime.onMessage.addListener((e,r,o)=>(console.log("[StorageSync CS] 收到消息:",e),o({success:!1,error:"功能尚未实现"}),!0));
})()
