view.loader = async function(){
    const response = await fetch("/manifest.json") ;
    let manifest = {} ;
    if(response.ok){
        manifest = await response.json() ;
    }
    return { manifest: JSON.stringify(manifest, null, 4), message:"" }
} ;

view.saveSettings = async function(){
    let response = await fetch("/open-bamz-pwa/saveManifest", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            manifestData: this.data.manifest
        })
    }) ;
    if(response.ok === false){
        throw new Error("Error saving manifest: " + response.statusText) ;
    }
    this.data.message = "Manifest saved successfully." ;
    setTimeout(() => {
        this.data.message = "";
    }, 5000);
} ;

view.regenerateSW = async function(){
    let response = await fetch("/open-bamz-pwa/build", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            manifestData: this.data.manifest
        })
    }) ;
    if(response.ok === false){
        throw new Error("Error building service worker: " + response.statusText) ;
    }
    this.data.message = "Service worker built successfully." ;
    setTimeout(() => {
        this.data.message = "";
    }, 5000);
} ;