$content = [System.IO.File]::ReadAllText('MonalissaFinalBone.js')
$content = $content -replace '(?m)^\s*var prefix = isMedpart \? "M" : "U";\r?\n?', ''
$content = $content -replace '(?m)^\s*var jenis = isMedpart \? "Media Partner" : "Undangan";\r?\n?', ''
$content = $content -replace '\(isMedpart \? "Medpart" : "Undangan"\)', 'jenis'
[System.IO.File]::WriteAllText('MonalissaFinalBone.js', $content)
