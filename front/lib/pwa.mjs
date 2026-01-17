if ('serviceWorker' in navigator) {
    //load service worker
    async function loadPWA() {
        if(window.LOGGED_BAMZ_USER){
            //logged as bamz user, don't load PWA to always force source refresh
            return;
        }
        try {
            //add manifest to header
            const link = document.createElement("LINK") ;
            link.setAttribute("rel", "manifest");
            link.setAttribute("href", `/manifest.json`);
            document.head.appendChild(link);

            let registration = await navigator.serviceWorker.register(`/sw.js`) ;

            registration.update().catch(() => {
                /* it is non blocking and we don't care if it failed */
            });

            registration.addEventListener('updatefound', () => {
                const installingWorker = registration.installing;

                installingWorker.addEventListener('statechange', () => {
                    if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        // New or updated content is available
                        window.dispatchEvent(new CustomEvent("pwa-update-available")) ;
                        //window.alert('A new version of this application is available. Please refresh the page to update.');
                    }
                });
            });
        } catch (err) {
            console.error("Error loading PWA manifest: ", err) ;
        }
    }

    if (document.readyState === "complete") {
        loadPWA() ;
    } else {
        window.addEventListener('load', () => {
            loadPWA() ;
        });
    }

}
