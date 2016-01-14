var path    = require('path'),
    http    = require('http'),
    url     = require('url'),
    postcss = require('postcss');

var reVALUE        = /([\.0-9]+)(%|em|ex|ch|rem|vw|vh|vmin|vmax|cm|mm|in|pt|pc|px|deg|grad|rad|turn|s|ms|dpi|dpcm|dppx|fr)/i;
var reIMAGE_VALUE  = /^(?!(?:url\(|"|').*?(image-width|image-height)).*?(image-width|image-height).*?/i;
var reURL          = /url\s*\(\s*(['"]?)([^\)'"]+)\1\s*\)\s+(\dx)/gi;
var reIMAGE_SET    = /-webkit-image-set\(\s*,\s*\)/gi;
var reALL_PSEUDO   = /::(before|after|first-line|first-letter)/gi;
var reNO_SETURL    = /url\(\s*(['"]?)([^\)'"]+)\1\s*\)/gi;
var reBLANK_LINE   = /(\r\n|\n|\r)(\s*?\1)+/gi;
var reBEFORE_AFTER = /::|:(before|after)/gi;
var reBASE64       = /^data:image\/(png|jpg|jpeg|gif);base64,/;



/**
 * 删除多余的 display: block
 * 当存在 float: left|right & position: absolute|fixed 时无需写 display: block;
 */
var removeDisplay = function(decl) {
  if (
    ((decl.prop == 'position') && (decl.value == 'absolute' || decl.value == 'fixed' || decl.value == 'center')) ||
    (decl.prop == 'float' && decl.value != 'none')
  ) {
    // 不存在 display: none 时删掉 display
    decl.parent.each(function(neighbor) {
      if ((neighbor.prop == 'display') && (neighbor.value == 'block' || neighbor.value == 'inline-block')) {
        //存在时删掉它
        neighbor.remove();
      }
    });
  }
}


/**
 * 删除多余的 float
 * 当存在 position: absolute|fixed, display: flex 时删除多余的 float
 */
var removeFloat = function(decl) {
  if (
    ((decl.prop == 'position') && (decl.value == 'absolute' || decl.value == 'fixed'))
  ) {
    decl.parent.each(function(neighbor) {
      if (
        (neighbor.prop == 'float' && neighbor.prop != 'none')
      ) {
        neighbor.remove();
      }
    });
  }
}

//伪元素只保留一个冒号
var removeColons = function(rule, i) {
  if (rule.selector.match(reALL_PSEUDO)) {
    rule.selector = rule.selector.replace(/::/g, ':');
  }
}

// position: center mixin
function positionCenterMixin(decl, i) {
  var hasPosition = decl.parent.some(function(i) {
    return i.prop == 'position' && i.value == 'center';
  });
  var hasWidth = decl.parent.some(function(i) {
    return i.prop == 'width';
  });
  var hasHeight = decl.parent.some(function(i) {
    return i.prop == 'height';
  });

  if (hasPosition && hasWidth && hasHeight) {
    var widthValue, heightValue, matchWidth, matchHeight;
    if (decl.prop == 'position') {
      decl.value = 'absolute';
      decl.parent.walkDecls(function(decl) {

        if (decl.prop == 'width') {
          matchWidth = decl.value.match(reVALUE);
          if (matchWidth && matchWidth != null) {
            widthValue = (-matchWidth[1] / 2) + matchWidth[2];
          }
        }
        if (decl.prop == 'height') {
          matchHeight = decl.value.match(reVALUE);
          if (matchHeight != null) {
            heightValue = (-matchHeight[1] / 2) + matchHeight[2];
          }
        }
      });

      //在后面插入计算的内容
      var reBefore = decl.raws.before.replace(reBLANK_LINE, '$1')

      insertDecl(decl, i, {
        raws: {           before: reBefore       },
        prop: 'margin-top',
        value: heightValue
      });
      insertDecl(decl, i, {
        raws: {           before: reBefore       },
        prop: 'margin-left',
        value: widthValue
      });
      insertDecl(decl, i, {
        raws: {           before: reBefore       },
        prop: 'top',
        value: '50%'
      });
      insertDecl(decl, i, {
        raws: {           before: reBefore       },
        prop: 'left',
        value: '50%'
      });
    }

  }
}

/**
 * ellipsis mixin
 * 保证可以显示省略号
 */
function ellipsisMixin(decl, i) {
  // var decl = decl.parent.childs[i];
  if (decl.prop == 'text-overflow' && decl.value == 'ellipsis') {
    var reBefore = decl.raws.before.replace(reBLANK_LINE, '$1')
    var countOverflow = 0,
      countWhitespace = 0;

    decl.parent.walkDecls(function(decl) {
      // 如果存在 overflow 且不等于 hidden, 增加 white-space
      if (decl.prop == 'overflow') {
        decl.value = 'hidden';
        countOverflow++;
      }

      if (decl.prop == 'white-space') {
        decl.value = 'nowrap';
        countWhitespace++;
      }
    });

    if (countOverflow == 0 && countWhitespace == 0) {
      insertDecl(decl, i, {
        raws: {           before: reBefore       },
        prop: 'overflow',
        value: 'hidden'
      });

      insertDecl(decl, i, {
        raws: {           before: reBefore       },
        prop: 'white-space',
        value: 'nowrap'
      });
    } else if (countOverflow == 0) {
      insertDecl(decl, i, {
        raws: {           before: reBefore       },
        prop: 'overflow',
        value: 'hidden'
      });
    } else if (countWhitespace == 0) {
      insertDecl(decl, i, {
        raws: {           before: reBefore       },
        prop: 'white-space',
        value: 'nowrap'
      });
    }
  }
}

/**
 * resize mixin
 * resize 只有在 overflow 不为 visible 时生效
 */
function resizeMixin(decl, i) {
  if (decl.prop == 'resize' && decl.value !== 'none') {
    var count = 0;
    decl.parent.walkDecls(function(decl) {
      if (decl.prop == 'overflow')
        count++;
    });
    if (count === 0) {
      var reBefore = decl.raws.before.replace(reBLANK_LINE, '$1')

      insertDecl(decl, i, {
        raws: {           before: reBefore       },
        prop: 'overflow',
        value: 'auto'
      });
    }
  }

}

/**
 * clearfix mixin
 * 新增 clear: fix 属性
 */
function clearfixMixin(decl, i) {
  if (decl.prop == 'clear' && decl.value == 'fix') {
    decl.prop = '*zoom';
    decl.value = '1';

    var count = 0;

    //当存在这些属性的时候不生成伪元素
    decl.parent.walkDecls(function(decl) {
      if (
        (decl.prop == "overflow" && decl.value != 'visible') ||
        (decl.prop == "display" && decl.value == 'inline-block') ||
        (decl.prop == "position" && decl.value == 'absolute') ||
        (decl.prop == "position" && decl.value == 'fixed')
      ) {
        count++;
      }
    });

    if (count === 0) {
      var bothSelector = decl.parent.selector + ':before' + ',\n' + decl.parent.selector + ':after';
      var afterSelector = decl.parent.selector + ':after';

      var bothRule = postcss.rule({
        selector: bothSelector
      });

      var afterRule = postcss.rule({
        selector: afterSelector
      });

      decl.parent.parent.insertAfter(decl.parent, bothRule);
      decl.parent.parent.insertAfter(decl.parent, afterRule);

      bothRule.append({
        prop: 'content',
        value: "''"
      }).append({
        prop: 'display',
        value: 'table'
      });

      afterRule.append({
        prop: 'clear',
        value: 'both'
      });
    } else {
      if (decl.next() && decl.next().type == "comment") {
        decl.next().remove();
      }
      decl.remove();
    }
  }
}

/**
 * IE opacity hack
 * 转换为 IE filter
 */
function ieOpacityHack(decl, i) {
  //四舍五入
  var amount = Math.round(decl.value * 100);
  if (decl.prop == 'opacity') {

    var reBefore = decl.raws.before.replace(reBLANK_LINE, '$1');

    insertDecl(decl, i, {
      raws: {           before: reBefore       },
      prop: 'filter',
      value: 'alpha(opacity=' + amount + ')'
    });
  }
}

// IE inline-block hack
function ieInlineBlockHack(decl, i) {
  if (decl.prop == 'display' && decl.value == 'inline-block') {

    var reBefore = decl.raws.before.replace(reBLANK_LINE, '$1')

    insertDecl(decl, i, {
      raws: {           before: reBefore       },
      prop: '*zoom',
      value: 1
    });
    insertDecl(decl, i, {
      raws: {
          before: reBefore
      },
      prop: '*display',
      value: 'inline'
    });
  }
}

//在后面插入新的属性，并保持注释在当前行
function insertDecl(decl, i, newDecl) {
  var next = decl.next(),
    declAfter;
  if (next && next.type == 'comment' && next.raws.before.indexOf('\n') == -1) {
    declAfter = next;
  } else {
    declAfter = decl;
  }

  decl.parent.insertAfter(declAfter, newDecl)
}

var cssgraceRule = function(rule, i) {

  //1x或者默认图片的宽高
  var normalWidth = '',
      normalHeight = '';

  //遍历 selectors
  removeColons(rule, i);

  //遍历 decl
  rule.walkDecls(function(decl, i) {
    removeDisplay(decl, i);
    //ieInlineBlockHack(decl, i);
    ieOpacityHack(decl, i);

    //ellipsisMixin(decl, i);
    //resizeMixin(decl, i);
  });

  rule.walkDecls(function(decl, i) {
    clearfixMixin(decl, i);
  });

  rule.walkDecls(function(decl, i) {
    positionCenterMixin(decl, i);
    removeFloat(decl, i);
    removeDisplay(decl, i);
  });
};

//根据decl.value的值，返回paths数组
function returnURL(val, reg) {
  var result, paths = [];
  while ((result = reg.exec(val)) != null) {
    paths.push(result);
  }
  return paths;
}

//当前处理文件的路径，可以通过处理函数的opts.from得到
var currentFilePath = '';
//获取css文件中的资源的绝对地址
function getAbsolutePath(sourcePath) {
  //移除url中带有 ？参数的内容
  return path.resolve(currentFilePath, sourcePath.split("?")[0]);
}

function getCurrentFilePath(node) {
  var inputfile = node.source && node.source.input && node.source.input.file;
  var dirname = inputfile ? path.dirname(inputfile) : '';
  return dirname;
}

// PostCSS Processor
var cssprocess = function(css) {
  //保存当前处理文件路径
  currentFilePath = getCurrentFilePath(css) || currentFilePath;
  css.walkRules(cssgraceRule);
}

var pack = function(css, opts) {
  //保存当前处理文件路径
  currentFilePath = path.dirname(opts.from);
  return postcss(cssprocess).process(css, opts).css;
}

exports.postcss = cssprocess
exports.pack = pack
