var addon;
var chromeHandle;

function install() {}

async function startup({ rootURI }) {
  const startupService = Components.classes['@mozilla.org/addons/addon-manager-startup;1']
    .getService(Components.interfaces.amIAddonManagerStartup);
  chromeHandle = startupService.registerChrome(Services.io.newURI(rootURI + 'manifest.json'), [
    ['content', 'pdf-metadata-refresh', rootURI + 'content/']
  ]);
  Services.scriptloader.loadSubScript(rootURI + "content/main.js");
  // The bundle is loaded into this scope, not onto the global object. Publishing
  // it on Zotero is what lets Tools → Run JavaScript and the integration harness
  // drive the same code the batch window drives.
  Zotero.PDFMetadataRefresh = PDFMetadataRefresh;
  addon = new PDFMetadataRefresh.Addon();
  await addon.startup();
}

async function shutdown() {
  try {
    if (addon) await addon.shutdown();
  }
  finally {
    addon = null;
    try {
      if (chromeHandle) chromeHandle.destruct();
    }
    finally {
      chromeHandle = null;
      try {
        if (Zotero.PDFMetadataRefresh) delete Zotero.PDFMetadataRefresh;
      }
      finally {
        if (typeof PDFMetadataRefresh !== "undefined") PDFMetadataRefresh = undefined;
      }
    }
  }
}

function uninstall() {}

function onMainWindowLoad({ window }) { addon?.registerWindow(window); }
function onMainWindowUnload({ window }) { addon?.unregisterWindow(window); }
