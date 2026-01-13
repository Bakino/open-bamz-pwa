import express from 'express';
import path from 'path';
const cheerio = await import('cheerio');
const acorn = await import('acorn');
import {glob} from 'glob';
import { fileURLToPath } from "url";
import workboxBuild from 'workbox-build';
import {readFile} from 'fs/promises';


/**
 * Called on each application startup (or when the plugin is enabled)
 * 
 * Use it to prepare the database and files needed by the plugin
 */
export const prepareDatabase = async ({options, appFileSystems}) => {
    //create default manifest file if not exist
    const appFs = appFileSystems.getFileSystem(options.database);
    if(!await appFs.pathExists("manifest.json")){
        await appFs.writeFile("manifest.json", JSON.stringify({
            name: options.database,
            short_name: options.database,
            description: options.database,
            start_url: "/",
            dir: "auto",
            lang: "en",
            display: "standalone",
            orientation: "any",
            background_color: "#fff",
            theme_color: "#fff",
            icons: [
                {
                    src: "/icons/icon.svg",
                    sizes: "any",
                    type: "image/svg+xml",
                    purpose: "any maskable"
                },
                {
                    src: "/icons/icon-192.png",
                    sizes: "192x192",
                    type: "image/png"
                },
                {
                    src: "/icons/icon-512.png",
                    sizes: "512x512",
                    type: "image/png"
                }
            ]
        }, null, 4), {encoding: "utf8"}) ;
    }

    const filesToCopy = [
        "sw-template.js",
        "icons/icon.svg",
        "icons/icon-192.png",
        "icons/icon-512.png",
    ]

    for(let f of filesToCopy){
        //let destFile = path.join(publicDir, f) ;
        if(!await appFs.pathExists(f)){
            //copy the default file
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            await appFs.writeFile(f, await readFile(path.join(__dirname, "resources", f))) ;
        }
    }
}

/**
 * Called when the plugin is disabled
 * 
 * Use it to eventually clean the database and files created by the plugin
 */
export const cleanDatabase = async ({options, appFileSystems}) => {
    const appFs = appFileSystems.getFileSystem(options.database);
    if(await appFs.pathExists( "manifest.json")){
        await appFs.remove( "manifest.json") ;
    }
}


function extractUrlsFromHTML(html) {
    const $ = cheerio.load(html);
    const urls = [];
  
    $('script[src], link[href]').each((index, element) => {
      const src = $(element).attr('src') || $(element).attr('href');
      const rel = $(element).attr('rel')
      if (src && src.startsWith('https://') && rel !== "preconnect") {
        urls.push(src);
      }
    });
  
    return urls;
}
function findImportURLs(node, content) {
    let urls = [];

    if (node.type === 'ImportDeclaration') {
        urls.push(node.source.value);
    }else if (node.type === 'ImportExpression') {
        //console.log("NODE ?", node.source) ;
        if(node.source.value){
            urls.push(node.source.value.replace(/^'/, "").replace(/'$/, ""));
        }
   /* don't do that because the URL may be a dynamic endpoint we should not try to download it
   }else if(node.type === "ExpressionStatement"){
        if(node.expression?.left?.property?.name === "href") {
            if(node.expression?.right?.type === "TemplateLiteral"){
                let literalStr = content.substring(node.expression.right.start+1, node.expression.right.end-1) ;
                urls.push(literalStr);
            }
        }*/
    }

    // Traverse child nodes
    for (let key in node) {
        if (node[key] && typeof node[key] === 'object') {
            urls = urls.concat(findImportURLs(node[key], content));
        }
    }

    return urls;
}

async function extractUrlsFromJsContent(content, url, logger){
    let urls = [];
    
    try{
        //urls = findImportURLs(acorn.parse(content, { ecmaVersion: 2022, sourceType: "module", allowImportExportEverywhere: true }));
        urls = findImportURLs(
            acorn.parse(content, { ecmaVersion: "latest", sourceType: "module", 
            allowImportExportEverywhere: true, allowAwaitOutsideFunction: true }),
            content
        );
        logger.info("Parsed JS url "+url+" found %o", urls);
    }catch(err){
        logger.error("Error parsing JS url "+url+" %o in %o", err, content);
    }
  
    return urls;
}

async function extractUrlsFromJS(file, logger) {
    let urls = [];
    
    try{
        const content = await readFile(file, {encoding: "utf8"}) ;

        urls = findImportURLs(acorn.parse(content, { ecmaVersion: 2022, sourceType: "module", allowImportExportEverywhere: true }));
        logger.info("Parsed JS file "+file+" found %o", urls);
    }catch(err){
        logger.error("Error parsing JS file "+file+" %o in %o", err);
    }
  
    return urls;
}

/**
 * Init plugin when Open BamZ platform start
 */
export const initPlugin = async ({logger, userLoggedAndHasPlugin, hasCurrentPlugin, contextOfApp, appFileSystems}) => {
    const router = express.Router();

    //const __filename = fileURLToPath(import.meta.url);
    //const __dirname = path.dirname(__filename);

    router.post("/saveManifest", async (req, res)=>{
        try{
            // Check user has proper authorization
            if(!await userLoggedAndHasPlugin(req, res)){ return }
            let appName = req.appName;

            if(!req.body.manifestData){
                return res.status(400).json({error: "Missing manifest data"}) ;
            }
            let manifestData = req.body.manifestData ;

            await appFileSystems.getFileSystem(appName).writeFile("manifest.json", manifestData, {encoding: "utf8"}) ;

            res.json({ success: true })
        }catch(err){
            logger.error("Error while saving manifest %o", err) ;
            res.status(err.statusCode??500).json({error: err});
        }
    })

    //build PWA service worker
    router.post("/build", async (req, res)=>{
        try{
            // Check user has proper authorization
            if(!await userLoggedAndHasPlugin(req, res)){ return }

            let appName = req.appName;

            await buildServiceWorker(appName)
            //logger.info("Generated SW with "+count+" / "+size);


            res.json({ success: true })
        }catch(err){
            logger.error("Error while building PWA %o", err) ;
            res.status(err.statusCode??500).json(err);
        }
    });

    function isJavascript(contentType){
        return contentType.includes("javascript") ;
    }

    async function buildServiceWorker(appName){
        //get the application context (all plugins informations)
        let appContext = await contextOfApp(appName);

        //list all application files
        const filesDirectory = path.join(process.env.DATA_DIR, "apps" ,appName, "public");
        const files = await glob(`${filesDirectory}/**/*`, {ignore: ['**/*.d.ts']});


        const globPatterns = []; 

        // always add to cache the index.html + openbamz admin script
        const additionalManifestEntries = [
            {revision: Date.now().toString(), url: "index.html"},
            {revision: Date.now().toString(), url: "/_openbamz_admin.js?appName="+appName},
        ]; 

        const localBaseUrl = "http://localhost:3000" ; 

        function addToManifestEntries(url){
            if(url.startsWith(localBaseUrl)){
                url = url.replace(localBaseUrl, "") ;
            }
            if(url.includes("?appName="+appName)){
                url = url.replace("?appName="+appName, "") ;
            }
            if(!globPatterns.includes(url) && !additionalManifestEntries.some(e=>e.url === url)){
                additionalManifestEntries.push({revision: Date.now().toString(), url: url});
            }
        }

        let filesToAnalyze = [];
        // if other plugin registered urls to cache, add them
        if(appContext.pluginsData["open-bamz-pwa"].pluginSlots?.urlsToCache){
            for(let u of appContext.pluginsData["open-bamz-pwa"].pluginSlots.urlsToCache){

                addToManifestEntries(u.url);
                let url = u.url ;
                if(!url.startsWith("/")){
                    url = "/"+url ;
                }
                url = localBaseUrl + url ;
                const response = await fetch(`${url}?appName=${appName}`);
                //console.log(">>>>>> response content type", u.url, response.headers.get("content-type") )
                if(response.ok && isJavascript(response.headers.get("content-type"))){
                    filesToAnalyze.push({
                        baseUrl: url,
                        fileContent: await response.text()
                    }) ;
                }
            }
        }

        
        for(let f of files){
            let filePath = path.relative(filesDirectory, f);
            if(filePath === "sw.js"){ continue ; }

            if (f.endsWith('.html') || f.endsWith('.js') || f.endsWith('.mjs')) {
                // source to be parse for dependencies caching (search for CDN to cache inside)
                filesToAnalyze.push({
                    baseUrl: filePath,
                    filePath: f
                });
            }

            //index.html is cached globally because admin JS is dynamically injected inside
            if(filePath === "index.html"){ continue ; }

            //add the file to cache (with its checksum as revision)
            globPatterns.push(filePath);
        }

        // look at plugins to cache plugin file and deps
        for(let pluginId of Object.keys(appContext.pluginsData)){
            let pluginData = appContext.pluginsData[pluginId];
            if(pluginData.frontEndLib){
                //The plugin has a frontend lib loaded automatically

                //add the file itself
                addToManifestEntries(`/plugin/${pluginId}/${pluginData.frontEndLib}`);

                //add plugin file to analyze (search for CDN or other files imported)
                filesToAnalyze.push({
                    baseUrl: `/plugin/${pluginId}/${pluginData.frontEndLib}`,
                    filePath: path.join(pluginData.frontEndFullPath, pluginData.frontEndLib)
                });
            }
        }

        //console.log("filesToAnalyze ?", filesToAnalyze) ;
        while(filesToAnalyze.length>0){
            let file = filesToAnalyze.shift();
            //console.log("start analyse ", file.baseUrl);
            let f = file.filePath ;
            let urls = [];

            //extraction imported URL from JS/HTML
            if(file.fileContent){
                urls = await extractUrlsFromJsContent(file.fileContent, file.baseUrl, logger) ;
            }else if (f.endsWith('.html')) {
                const content = await readFile(f, {encoding: "utf8"}) ;
                urls = extractUrlsFromHTML(content);
            } else if (f.endsWith('.js') || f.endsWith('.mjs')) {
                urls = await extractUrlsFromJS(f, logger);
            }

            //console.log("URLS ??? ", file.baseUrl, urls);
            for(let url of urls){
                let fullUrl = url;
                let revision = null;
                if(url.startsWith("http")){
                    console.log("fetch http ", file.baseUrl, url);
                    // fetch to get dependencies
                    const response = await fetch(url);
                    //console.log("response content type", url, response.headers.get("content-type") )
                    if(response.ok && isJavascript(response.headers.get("content-type"))){
                        filesToAnalyze.push({
                            baseUrl: fullUrl,
                            fileContent: await response.text()
                        }) ;
                    }
                }else if(!file.filePath){
                    //from an URL fetch
                    console.log("fetch sub http ", file.baseUrl, url);
                    // fetch to get dependencies
                    url = url.replace(/^\.\//, "") ;
                    if(url.startsWith("/")){
                        fullUrl = file.baseUrl.substring(0, file.baseUrl.indexOf("/", 9))+url;
                    }else if(file.baseUrl.startsWith("http")){
                        //from a fetched URL
                        let indexLastSlash = file.baseUrl.lastIndexOf("/");
                        fullUrl = file.baseUrl.substring(0, indexLastSlash+1)+url;
                    }else{
                        fullUrl = path.join(path.dirname(file.baseUrl), url);
                    }
                    if(fullUrl.startsWith(localBaseUrl)){
                        //pass the appName
                        fullUrl += "?appName="+appName;
                    }
                    const response = await fetch(fullUrl);
                    console.log("response content type", fullUrl, response.headers.get("content-type") )
                    if(response.ok && isJavascript(response.headers.get("content-type"))){
                        filesToAnalyze.push({
                            baseUrl: fullUrl,
                            fileContent: await response.text()
                        }) ;
                    }
                }else{
                    console.log("fetch file ", file.baseUrl, url);
                    //relative path
                    fullUrl = path.join(path.dirname(file.baseUrl), url);
                    
                    //revision = Date.now().toString(); //TODO use md5sum
                    filesToAnalyze.push({
                        baseUrl: fullUrl,
                        filePath: path.join(path.dirname(file.filePath), url)
                    }) ;
                }
                addToManifestEntries(fullUrl) ;
            }
        }
        

        // Generate the service worker
        const swDestPath = path.resolve(filesDirectory, 'sw.js')
        const { /*count, size,*/ warnings } = await workboxBuild.injectManifest({
            globDirectory: filesDirectory, // Set the glob directory to current
            globPatterns: globPatterns, // Use relative paths
            additionalManifestEntries: additionalManifestEntries,
            swSrc: path.resolve(filesDirectory, 'sw-template.js'), // Path to your template service worker
            swDest: swDestPath, // Output path for generated service worker
            modifyURLPrefix: {},
        });
        if (warnings.length) {
            //console.warn('Warnings:', warnings.join('\n'));
        }

        console.log(`Service worker for app ${appName} generated at ${swDestPath}`);

        await appFileSystems.getFileSystem(appName).emit("fileWritten", {filePath: swDestPath, relativePath: "sw.js", branch: "public"}) ;
    }

    appFileSystems.addListener("fileWritten", async ({appName, relativePath})=>{
        if(relativePath === "sw.js"){ return ; }
        if(await hasCurrentPlugin(appName)){
            //rebuild service worker
            await buildServiceWorker(appName) ;
        }
    });
    appFileSystems.addListener("fileDeleted", async ({appName, relativePath})=>{
        if(relativePath === "sw.js"){ return ; }
        if(await hasCurrentPlugin(appName)){
            //rebuild service worker
            await buildServiceWorker(appName) ;
        }
    });


    return {
        // path in which the plugin provide its front end files
        frontEndPath: "front",
        //lib that will be automatically load in frontend
        frontEndLib: "lib/pwa.mjs",
        router: router,
        //menu entries
        menu: [
            {
                name: "admin", entries: [
                    { name: "PWA Settings", link: "/plugin/open-bamz-pwa/settings/index.html" }
                ]
            }
        ],
        pluginSlots: {
            // slot to allow other plugins to register URL to cache
            urlsToCache: []
        }
    }
}