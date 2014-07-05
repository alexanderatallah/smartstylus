var fs = Npm.require('fs');
var stylus = Npm.require('stylus');
var nib = Npm.require('nib');
var path = Npm.require('path');
var Future = Npm.require('fibers/future');
var Storage = Npm.require('node-persist');

Storage.initSync({
  dir: 'stylus-cache'
//  logging: true
});

// Keep track of mod times for files that have been parsed
var Mtimes = {};

// Keep track of files in a cache
Storage.setItem('cache', {});

// Check whether a given key has a new modification time
var wasModified = function(key, stats) {
  //  !Options.useCache ||
  return !Mtimes[key] || new Date(Mtimes[key]).getTime() != new Date(stats.mtime).getTime();
}

var compileFromCache = function(compileStep, future) {
  // console.log("CACHE " + compileStep.inputPath);
  var filename = compileStep.inputPath;
  var src = Storage.getItem('cache')[filename];
  if (src && src.length) {
    compileStep.addStylesheet({
      path: filename + ".css",
      data: src
    });
    future.return(true);
  } else {
    future.return(false);
  }
}

var compile = function(compileStep, future) {
  var f = new Future;
  stylus(compileStep.read().toString('utf8'))
    .use(nib())
    .set('filename', compileStep.inputPath)
    // Include needed to allow relative @imports in stylus files
    .include(path.dirname(compileStep._fullInputPath))
    .render(f.resolver());

  try {
    console.log("Compiling " + compileStep.inputPath);
    var css = f.wait();
  } catch (e) {
    compileStep.error({
      message: "Stylus compiler error: " + e.message
    });
    return future.return(false);
  }

  var cache = Storage.getItem('cache');
  cache[compileStep.inputPath] = css;
  Storage.setItem('cache', cache);

  compileStep.addStylesheet({
    path: compileStep.inputPath + ".css",
    data: css
  });

  future.return(true);
}

Plugin.registerSourceHandler("styl", function (compileStep) {
  // XXX annoying that this is replicated in .css, .less, and .styl
  if (! compileStep.archMatches('browser')) {
    // XXX in the future, might be better to emit some kind of a
    // warning if a stylesheet is included on the server, rather than
    // silently ignoring it. but that would mean you can't stick .css
    // at the top level of your app, which is kind of silly.
    return;
  }

  var future = new Future;

  fs.stat(compileStep.inputPath, function(err, stats) {
    var doCompile = true;
    var filename = compileStep.inputPath;
    var key = filename + "|" + compileStep.arch;

    if (!wasModified(key, stats)) doCompile = false;

    if (doCompile) {
      stats && (Mtimes[key] = stats.mtime);
      compile(compileStep, future);
    } else {
      compileFromCache(compileStep, future);
    }
  });

  future.wait();
});

// Register import.styl files with the dependency watcher, without actually
// processing them. There is a similar rule in the less package.
Plugin.registerSourceHandler("import.styl", function () {
  // Do nothing
});

