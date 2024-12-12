
export let freeBusyStore: {[key: string]: any} = {};
export let userInfoStore: {[key: string]: any} = {};
export let responseStore: {[key: string]: any} = {};




setInterval(()=>{
    freeBusyStore={};
}, Number(process.env.FREE_BUSY_CACHE_TTL_SECONDS || 30))

// Reset the user info store hourly
setInterval(()=>{
    userInfoStore={};
}, Number(3600 * 1000))