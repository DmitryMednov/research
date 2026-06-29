(function(){
  var REPO = 'DmitryMednov/KHBuild';
  var MONTHS = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  var FALLBACK = '22 апр 2026';

  function fmt(iso) {
    var d = new Date(iso);
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function build(dateText, count) {
    var extra = count != null ? ' · всего коммитов: ' + count : '';
    return '<div style="margin-top:14px; padding-top:12px; border-top:1px solid rgba(201,166,93,0.25); font-size:11px; opacity:0.85;">' +
      'Последнее обновление: <strong>' + dateText + '</strong>' + extra +
      ' · <a href="changelog.html" style="color:#C9A65D; text-decoration:none; font-weight:700;">История изменений →</a>' +
      '</div>';
  }

  function inject(dateText, count) {
    var footers = document.querySelectorAll('.footer');
    footers.forEach(function(f){
      if (f.querySelector('.site-last-update')) return;
      var wrap = document.createElement('div');
      wrap.className = 'site-last-update';
      wrap.innerHTML = build(dateText, count);
      f.appendChild(wrap);
    });
  }

  // Initial render with fallback
  inject(FALLBACK, null);

  // Try live data from GitHub
  try {
    fetch('https://api.github.com/repos/' + REPO + '/commits?per_page=100')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(data){
        if (!Array.isArray(data) || !data.length) return;
        var dateText = fmt(data[0].commit.committer.date);
        var count = data.length >= 100 ? '100+' : data.length;
        document.querySelectorAll('.site-last-update').forEach(function(el){ el.innerHTML = build(dateText, count); });
      })
      .catch(function(){});
  } catch(e) {}
})();
