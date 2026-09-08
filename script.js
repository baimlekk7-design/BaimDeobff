// ==================== BaimDeobf v4 ====================

// ---------- Utility: extract strings & comments (sama seperti sebelumnya) ----------
function extractProtectedChunks(code) {
    const chunks = [];
    let result = '';
    let i = 0;
    const len = code.length;

    while (i < len) {
        if (code[i] === '[' && (code[i+1] === '[' || /^\[=+\[/.test(code.slice(i)))) {
            let j = i + 1;
            while (j < len && code[j] === '=') j++;
            if (j < len && code[j] === '[') {
                const level = j - i - 1;
                const closeTag = ']' + '='.repeat(level) + ']';
                const start = i;
                const end = code.indexOf(closeTag, j + 1);
                if (end !== -1) {
                    const contentEnd = end + closeTag.length;
                    const chunk = code.slice(start, contentEnd);
                    chunks.push(chunk);
                    result += `__BAIM_CHUNK_${chunks.length - 1}__`;
                    i = contentEnd;
                    continue;
                }
            }
        }

        if (code.startsWith('--', i)) {
            if (code.startsWith('--[[', i) || /^--\[=*\[/.test(code.slice(i))) {
                let j = i + 2;
                while (j < len && code[j] === '=') j++;
                if (j < len && code[j] === '[') {
                    const level = j - i - 2;
                    const closeTag = ']' + '='.repeat(level) + ']';
                    const end = code.indexOf(closeTag, j + 1);
                    if (end !== -1) {
                        const contentEnd = end + closeTag.length;
                        const chunk = code.slice(i, contentEnd);
                        chunks.push(chunk);
                        result += `__BAIM_CHUNK_${chunks.length - 1}__`;
                        i = contentEnd;
                        continue;
                    }
                }
            }
            const endLine = code.indexOf('\n', i);
            const end = endLine === -1 ? len : endLine;
            const chunk = code.slice(i, end);
            chunks.push(chunk);
            result += `__BAIM_CHUNK_${chunks.length - 1}__`;
            i = end;
            continue;
        }

        const quote = code[i];
        if (quote === "'" || quote === '"') {
            let j = i + 1;
            let escaped = false;
            while (j < len) {
                if (escaped) {
                    escaped = false;
                } else if (code[j] === '\\') {
                    escaped = true;
                } else if (code[j] === quote) {
                    break;
                }
                j++;
            }
            if (j < len) {
                const chunk = code.slice(i, j + 1);
                chunks.push(chunk);
                result += `__BAIM_CHUNK_${chunks.length - 1}__`;
                i = j + 1;
                continue;
            }
        }

        result += code[i];
        i++;
    }

    return { codeWithoutChunks: result, chunks };
}

function restoreProtectedChunks(code, chunks) {
    return code.replace(/__BAIM_CHUNK_(\d+)__/g, (match, idx) => {
        return chunks[parseInt(idx)];
    });
}

// ---------- Remove comments ----------
function removeLuaComments(code) {
    code = code.replace(/--(?!\[\[).*$/gm, '');
    code = code.replace(/--\[=*\[[\s\S]*?\]=*\]/g, '');
    return code;
}

// ---------- Decode Lua escape sequences ----------
function decodeLuaEscape(str) {
    return str.replace(/\\(?:(\d{1,3})|x([0-9a-fA-F]{2})|u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|z|n|r|t|\\|"|')/g,
        (match, dec, hex, unicodeBraced, unicode4) => {
            if (dec) return String.fromCharCode(parseInt(dec, 10));
            if (hex) return String.fromCharCode(parseInt(hex, 16));
            if (unicodeBraced) return String.fromCodePoint(parseInt(unicodeBraced, 16));
            if (unicode4) return String.fromCharCode(parseInt(unicode4, 16));
            return match;
        });
}

function decodeEscapesInCode(code) {
    return code.replace(/(['"])((?:\\.|(?!\1)[^\\])*)\1/g, (match, quote, inner) => {
        return quote + decodeLuaEscape(inner) + quote;
    });
}

// ---------- Try Base64 decode ----------
function tryBase64DecodeStrings(code) {
    return code.replace(/(['"])((?:\\.|(?!\1)[^\\])*)\1|\[=*\[[\s\S]*?\]=*\]/g, (match) => {
        let content = match;
        let prefix = '';
        let suffix = '';
        if (match.startsWith("'") || match.startsWith('"')) {
            prefix = match[0];
            suffix = match[match.length - 1];
            content = match.slice(1, -1);
            content = content.replace(/\\(['"\\])/g, '$1');
        } else {
            const eqIndex = match.indexOf('[');
            const level = match.slice(1, eqIndex).length;
            const closeTag = ']' + '='.repeat(level) + ']';
            content = match.slice(eqIndex + 1, -closeTag.length);
            prefix = match.slice(0, eqIndex + 1);
            suffix = closeTag;
        }

        if (/^[A-Za-z0-9+/=\s]+$/.test(content) && content.trim().length > 8 && content.trim().length % 4 === 0) {
            try {
                const decoded = atob(content.trim());
                const controlChars = (decoded.match(/[\x00-\x08\x0E-\x1F]/g) || []).length;
                if (controlChars < decoded.length * 0.05) {
                    return prefix + decoded + suffix;
                }
            } catch (e) {}
        }
        return match;
    });
}

// ---------- Beautify / format ----------
function beautifyLua(code) {
    const { codeWithoutChunks, chunks } = extractProtectedChunks(code);

    let formatted = codeWithoutChunks;
    formatted = formatted.replace(/;/g, '\n');

    const keywordsBefore = ['function', 'then', 'do', 'else', 'elseif', 'end', 'until', 'repeat', 'local'];
    keywordsBefore.forEach(kw => {
        formatted = formatted.replace(new RegExp(`\\b${kw}\\b`, 'g'), `\n${kw}`);
    });

    formatted = formatted.replace(/\b(then|do|else|elseif|repeat)\b/g, '$1\n');
    formatted = formatted.replace(/\b(end|until)\b/g, '\n$1\n');
    formatted = formatted.replace(/[ \t]+/g, ' ');
    formatted = formatted.replace(/\n\s*\n+/g, '\n').trim();

    const lines = formatted.split('\n');
    let indentLevel = 0;
    const indentStr = '    ';
    const resultLines = [];

    lines.forEach(line => {
        line = line.trim();
        if (!line) return;
        if (/^(end|until|else|elseif)\b/.test(line)) {
            indentLevel = Math.max(0, indentLevel - 1);
        }
        resultLines.push(indentStr.repeat(indentLevel) + line);
        if (/\b(function|if|for|while|repeat|do|then|else|elseif)\b/.test(line)) {
            if (!/^(else|elseif)\b/.test(line)) {
                indentLevel++;
            }
        }
    });

    let result = resultLines.join('\n');
    result = restoreProtectedChunks(result, chunks);
    return result;
}

// ---------- Rename short variables ----------
function renameShortVariables(code) {
    const luaKeywords = new Set([
        'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for',
        'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or',
        'repeat', 'return', 'then', 'true', 'until', 'while'
    ]);
    const builtins = new Set([
        'print', 'type', 'tostring', 'tonumber', 'pcall', 'xpcall', 'error',
        'assert', 'select', 'rawget', 'rawset', 'rawlen', 'rawequal',
        'setmetatable', 'getmetatable', 'pairs', 'ipairs', 'next',
        'require', 'module', 'unpack', 'pack', 'load', 'loadstring',
        'loadfile', 'dofile', 'collectgarbage', 'gcinfo', '_G', '_VERSION',
        'coroutine', 'string', 'table', 'math', 'io', 'os', 'debug', 'utf8'
    ]);

    const { codeWithoutChunks, chunks } = extractProtectedChunks(code);
    const identifierRegex = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
    const identifiers = codeWithoutChunks.match(identifierRegex) || [];

    const freq = {};
    identifiers.forEach(id => {
        if (luaKeywords.has(id) || builtins.has(id)) return;
        if (id.length <= 2 || /^_0x[0-9a-fA-F]+$/.test(id)) {
            freq[id] = (freq[id] || 0) + 1;
        }
    });

    const sortedIds = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);
    const mapping = {};
    sortedIds.forEach((id, idx) => {
        mapping[id] = `var_${idx + 1}`;
    });

    let renamed = codeWithoutChunks.replace(identifierRegex, (match) => {
        return mapping[match] || match;
    });

    renamed = restoreProtectedChunks(renamed, chunks);
    return renamed;
}

// ---------- NEW: Auto Decode XOR Loop ----------
function tryDecodeSimpleXor(code) {
    const stringRegex = /local\s+\w+\s*=\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/s;
    const stringMatch = code.match(stringRegex);
    if (!stringMatch) return null;
    const rawString = stringMatch[2];

    const byteArray = [];
    let i = 0;
    while (i < rawString.length) {
        if (rawString[i] === '\\' && /\d/.test(rawString[i+1])) {
            let j = i + 1;
            let numStr = '';
            while (j < rawString.length && /\d/.test(rawString[j]) && numStr.length < 3) {
                numStr += rawString[j];
                j++;
            }
            if (numStr) {
                byteArray.push(parseInt(numStr, 10));
                i = j;
                continue;
            }
        }
        i++;
    }
    if (byteArray.length === 0) return null;

    const keyInitMatch = code.match(/local\s+\w+\s*=\s*(\d+)\s*;/);
    if (!keyInitMatch) return null;
    const keyInit = parseInt(keyInitMatch[1], 10);

    const constMatch = code.match(/__2,\s*(\d+)\s*\)\s*,\s*(\d+)\s*\)/);
    if (!constMatch) return null;
    const const1 = parseInt(constMatch[1], 10);
    const const2 = parseInt(constMatch[2], 10);

    let key = keyInit;
    let decodedStr = '';
    for (let idx = 0; idx < byteArray.length; idx++) {
        const byte = byteArray[idx];
        const decoded = byte ^ const1 ^ const2 ^ (key % 256) ^ (idx % 256);
        decodedStr += String.fromCharCode(decoded);
        key = byte;
    }

    return decodedStr;
}

// ---------- NEW: Auto Decode WeAreDevs ----------
function luaStringToJs(luaStr) {
    const quote = luaStr[0];
    const inner = luaStr.slice(1, -1);
    return inner.replace(/\\(?:(\d{1,3})|x([0-9a-fA-F]{2})|u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|(n|r|t|\\|"|'))/g,
        (match, dec, hex, unicodeBraced, unicode4, simple) => {
            if (dec) return String.fromCharCode(parseInt(dec, 10));
            if (hex) return String.fromCharCode(parseInt(hex, 16));
            if (unicodeBraced) return String.fromCodePoint(parseInt(unicodeBraced, 16));
            if (unicode4) return String.fromCharCode(parseInt(unicode4, 16));
            switch (simple) {
                case 'n': return '\n';
                case 'r': return '\r';
                case 't': return '\t';
                case '\\': return '\\';
                case '"': return '"';
                case "'": return "'";
                default: return simple;
            }
        });
}

function jsStringToLua(str) {
    let result = '"';
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code >= 32 && code <= 126 && str[i] !== '"' && str[i] !== '\\') {
            result += str[i];
        } else {
            result += '\\' + String(code).padStart(3, '0');
        }
    }
    result += '"';
    return result;
}

function extractStringsFromTableM(content) {
    const strings = [];
    const regex = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
    let m;
    while ((m = regex.exec(content)) !== null) {
        strings.push(m[0]);
    }
    return strings;
}

function evaluateArithmetic(expr) {
    let cleaned = expr.replace(/-\(-/g, '+(');
    cleaned = cleaned.replace(/\+-/g, '-');
    try {
        return Function('"use strict"; return (' + cleaned + ')')();
    } catch (e) {
        return null;
    }
}

function parseMappingM(content) {
    const mapping = {};
    const entryRegex = /([%w]+|%[\"'](?:\\.|[^\"'\\])*[\"']%])\s*=\s*([^,;}]+)/g;
    let m;
    while ((m = entryRegex.exec(content)) !== null) {
        let key = m[1];
        let value = m[2].trim();
        if (key.startsWith('["') || key.startsWith("['")) {
            const inner = key.slice(2, -2);
            key = inner.replace(/\\(?:(\d{1,3})|x([0-9a-fA-F]{2})|.)/g, (match, dec, hex, other) => {
                if (dec) return String.fromCharCode(parseInt(dec, 10));
                if (hex) return String.fromCharCode(parseInt(hex, 16));
                return other;
            });
        }
        const val = evaluateArithmetic(value);
        if (val !== null && !isNaN(val)) {
            mapping[key] = val;
        }
    }
    return mapping;
}

function decodeWeAreDevsString(encoded, charToVal) {
    let X = 0, D = 0;
    const bytes = [];
    for (let i = 0; i < encoded.length; i++) {
        const ch = encoded[i];
        if (ch === '=') {
            bytes.push(Math.floor(X / 65536));
            if (i >= encoded.length - 1 || encoded.slice(i+1, i+3) !== '==') {
                bytes.push(Math.floor((X % 65536) / 256));
            }
            break;
        }
        const val = charToVal[ch];
        if (val !== undefined) {
            X += val * Math.pow(64, 2 - D);
            D++;
            if (D === 3) {
                D = 0;
                bytes.push(Math.floor(X / 65536), Math.floor((X % 65536) / 256), X % 256);
                X = 0;
            }
        } else {
            break;
        }
    }
    return bytes.map(b => String.fromCharCode(b)).join('');
}

function tryDecodeWeAreDevs(code) {
    const mRegex = /local\s+m\s*=\s*\{([\s\S]*?)\}/;
    const mMatch = code.match(mRegex);
    if (!mMatch) return code;
    const mContent = mMatch[1];
    const originalStrings = extractStringsFromTableM(mContent);
    if (originalStrings.length === 0) return code;

    const MRegex = /local\s+M\s*=\s*\{([\s\S]*?)\}/;
    const MMatch = code.match(MRegex);
    if (!MMatch) return code;
    const charToVal = parseMappingM(MMatch[1]);
    if (!charToVal || Object.keys(charToVal).length === 0) return code;

    const decodedStrings = originalStrings.map(s => {
        const jsStr = luaStringToJs(s);
        return decodeWeAreDevsString(jsStr, charToVal);
    });

    const newMTable = 'local m={' + decodedStrings.map(s => jsStringToLua(s)).join(',') + '}';
    const newCode = code.replace(mRegex, newMTable);
    return newCode;
}

// ---------- Main pipeline ----------
function deobfuscate(code, options) {
    let result = code;

    if (options.autoXor) {
        const decoded = tryDecodeSimpleXor(result);
        if (decoded && decoded.length > 0) {
            result = decoded;
        }
    }

    if (options.autoWeAreDevs) {
        result = tryDecodeWeAreDevs(result);
    }

    if (options.removeComments) {
        result = removeLuaComments(result);
    }

    if (options.decodeEscapes) {
        result = decodeEscapesInCode(result);
    }

    if (options.decodeBase64) {
        result = tryBase64DecodeStrings(result);
    }

    if (options.renameVars) {
        result = renameShortVariables(result);
    }

    result = beautifyLua(result);
    return result;
}

// ---------- Terminal & Bytecode Tools ----------
function detectCodeType(code) {
    // Cek header LuaJIT bytecode: biasanya dimulai dengan 0x1B 0x4C 0x4A ("\27LJ") atau "LJ"
    if (code.startsWith('\x1bLJ') || code.startsWith('LJ') || /^\s*LJ/.test(code)) {
        return 'bytecode';
    }
    // Cek header Lua 5.1 bytecode: "\27Lua"
    if (code.startsWith('\x1bLua')) {
        return 'bytecode';
    }
    // Cek source biasa
    if (/^\s*(local|function|return|--|\(|if|for|while)/.test(code)) {
        return 'source';
    }
    // Jika banyak karakter non-printable, anggap bytecode
    const nonPrintable = (code.match(/[^\x20-\x7E\n\r\t]/g) || []).length;
    if (nonPrintable > code.length * 0.05) {
        return 'bytecode';
    }
    return 'unknown';
}

function convertTextToLuac(text) {
    // Jika teks berisi escape \ddd, konversi ke byte
    let binaryString = '';
    let i = 0;
    while (i < text.length) {
        if (text[i] === '\\' && /\d/.test(text[i+1])) {
            let j = i + 1;
            let numStr = '';
            while (j < text.length && /\d/.test(text[j]) && numStr.length < 3) {
                numStr += text[j];
                j++;
            }
            if (numStr) {
                binaryString += String.fromCharCode(parseInt(numStr, 10));
                i = j;
                continue;
            }
        }
        binaryString += text[i];
        i++;
    }
    return binaryString;
}

function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], {type: mimeType});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function extractVisibleStringsFromBytecode(text) {
    // Ekstrak string yang terdiri dari karakter printable (ASCII 32-126) dengan panjang > 3
    const strings = text.match(/[\x20-\x7E]{4,}/g) || [];
    // Filter yang bukan kode acak (heuristik sederhana)
    return strings.filter(s => !/^\s*$/.test(s));
}

function handleTerminalCommand(cmd, inputCode) {
    const output = [];
    switch (cmd.toLowerCase()) {
        case 'help':
            output.push('Perintah yang tersedia:');
            output.push('  detect  - Deteksi jenis input (source/bytecode)');
            output.push('  convert - Konversi teks escape \\ddd menjadi file .luac dan download');
            output.push('  extract - Ekstrak string terlihat dari bytecode');
            output.push('  help    - Tampilkan bantuan ini');
            break;
        case 'detect':
            const type = detectCodeType(inputCode);
            output.push(`Jenis input: ${type}`);
            if (type === 'bytecode') {
                output.push('Input adalah bytecode Lua/LuaJIT. Gunakan decompiler eksternal (unluac, dll).');
                output.push('Gunakan perintah "convert" untuk menyimpan sebagai .luac, atau "extract" untuk melihat string.');
            } else if (type === 'source') {
                output.push('Input adalah source code Lua. Anda bisa menggunakan tombol Deobfuscate.');
            } else {
                output.push('Tidak dapat menentukan jenis input.');
            }
            break;
        case 'convert':
            if (!inputCode.trim()) {
                output.push('Tidak ada input.');
                break;
            }
            const binary = convertTextToLuac(inputCode);
            downloadFile('obfuscated.luac', binary, 'application/octet-stream');
            output.push('File obfuscated.luac berhasil diunduh. Gunakan decompiler LuaJIT untuk memprosesnya.');
            break;
        case 'extract':
            const strings = extractVisibleStringsFromBytecode(inputCode);
            if (strings.length === 0) {
                output.push('Tidak ada string yang terdeteksi.');
            } else {
                output.push('String yang ditemukan:');
                strings.forEach(s => output.push('  ' + s));
            }
            break;
        default:
            output.push(`Perintah tidak dikenal: ${cmd}. Ketik 'help' untuk bantuan.`);
    }
    return output.join('\n');
}

// ---------- DOM Handling ----------
document.addEventListener('DOMContentLoaded', () => {
    const inputEl = document.getElementById('input');
    const outputEl = document.getElementById('output');
    const statusEl = document.getElementById('status');
    const deobfBtn = document.getElementById('deobfBtn');
    const clearBtn = document.getElementById('clearBtn');
    const copyBtn = document.getElementById('copyBtn');
    const sampleBtn = document.getElementById('sampleBtn');
    const sampleWeAreDevsBtn = document.getElementById('sampleWeAreDevsBtn');

    const chkRemoveComments = document.getElementById('removeComments');
    const chkDecodeEscapes = document.getElementById('decodeEscapes');
    const chkDecodeBase64 = document.getElementById('decodeBase64');
    const chkRenameVars = document.getElementById('renameVars');
    const chkAutoXor = document.getElementById('autoXor');
    const chkAutoWeAreDevs = document.getElementById('autoWeAreDevs');

    // Terminal elements
    const terminalInput = document.getElementById('terminalInput');
    const terminalOutput = document.getElementById('terminalOutput');
    const runTerminalBtn = document.getElementById('runTerminalBtn');
    const helpBtn = document.getElementById('helpBtn');

    // Contoh kode XOR (dari potongan yang dikirim sebelumnya) - disingkat agar tidak terlalu panjang
    const sampleCode = `local _G = Object_G or _G; local _____ = _G['string']; local ______ = _____['char']; local _______ = _____['byte']; local ________ = _G['bit'] and _G['bit']['bxor'] or function(a,b) return a~=b end; local ___ = '\\096\\078\\119\\075\\108\\081\\120\\029\\125\\082\\123\\088\\048\\026\\049\\027\\047\\024\\047\\023\\045\\023\\057\\070\\061\\100\\070\\114\\085\\119\\074\\109\\098\\033\\107\\110\\105\\100\\038\\056\\059\\053\\037\\034\\049\\056\\063\\041\\113\\035\\081\\034\\048\\032\\063\\035\\061\\110\\109\\125\\102\\097\\074\\090\\038\\072\\046\\083\\046\\001\\048\\029\\109\\011\\122\\014\\097\\020\\117\\088\\096\\008\\113\\005\\107\\090\\035\\072\\063\\066\\038\\068\\112\\078\\080\\041\\108\\036\\109\\040\\038\\126\\055\\123\\041\\101\\043\\085\\031\\081\\006\\087\\077\\075\\083\\017\\082\\103\\055\\101\\052\\102\\058\\043\\126\\060\\122\\061\\146\\055\\139\\029\\164\\014\\163\\030\\179\\030\\254\\002\\228\\014\\251\\052\\130\\054\\141\\053\\135\\120\\198\\098\\192\\114\\209\\115\\250\\076\\251\\090\\217\\068\\201\\000\\211\\028\\132\\027\\140\\010\\202\\011\\192\\010\\228\\011\\157\\009\\146\\010\\152\\071\\204\\084\\199\\068\\219\\068\\193\\105\\249\\109\\147\\121\\209\\101\\203\\063\\185\\020\\182\\021\\181\\111\\219\\110\\183\\018\\181\\014\\237\\026\\229\\023\\238\\078\\254\\046\\209\\044\\206\\121\\217\\121\\241\\118\\254\\058\\251\\048\\249\\056\\167\\055\\163\\052\\190\\057\\238\\039\\242\\061\\184\\051\\240\\099\\213\\072\\218\\073\\217\\051\\183\\051\\218\\079\\056\\083\\096\\071\\104\\074\\099\\019\\115\\099\\074\\103\\068\\109\\074\\106\\084\\047\\039\\023\\058\\017\\034\\019\\099\\028\\108\\080\\105\\090\\107\\082\\005\\093\\001\\095\\029\\082\\077\\076\\065\\086\\011\\088\\067\\008\\102\\035\\121\\034\\122\\088\\020\\095\\126\\035\\108\\063\\052\\043\\060\\038\\055\\127\\087\\024\\117\\015\\100\\025\\097\\076\\011\\105\\014\\099\\000\\037\\013\\040\\095\\043\\087\\043\\089\\123\\084\\125\\087\\104\\088\\058\\064\\056\\088\\112\\104\\062\\058\\025\\023\\024\\020\\025\\096\\113\\100\\024\\030\\004\\000\\094\\010\\080\\005\\089\\090\\071\\040\\125\\032\\103\\048\\116\\044\\057\\033\\052\\147\\055\\155\\055\\149\\103\\152\\097\\154\\117\\149\\039\\141\\037\\149\\109\\132\\034\\214\\005\\251\\004\\248\\005\\140\\109\\139\\007\\241\\027\\239\\065\\197\\079\\202\\070\\149\\088\\231\\107\\254\\115\\190\\048\\176\\049\\245\\067\\209\\069\\201\\087\\220\\077\\147\\066\\144\\014\\145\\004\\151\\012\\197\\003\\188\\007\\163\\010\\247\\020\\247\\014\\177\\001\\252\\081\\221\\122\\222\\123\\193\\001\\171\\005\\198\\121\\216\\101\\140\\113\\128\\124\\143\\037\\147\\069\\128\\070\\140\\068\\158\\017\\238\\043\\230\\049\\246\\034\\234\\111\\231\\098\\181\\097\\189\\097\\179\\049\\190\\054\\181\\042\\186\\120\\162\\122\\186\\050\\075\\125\\025\\090\\052\\091\\055\\090\\067\\050\\074\\086\\048\\074\\046\\016\\036\\030\\043\\023\\116\\009\\000\\039\\028\\109\\017\\096\\091\\099\\083\\099\\101\\051\\104\\052\\104\\043\\103\\121\\119\\123\\111\\051\\097\\123\\051\\092\\006\\093\\005\\092\\121\\052\\113\\081\\003\\077\\029\\023\\015\\025\\000\\016\\039\\014\\075\\018\\041\\004\\036\\009\\102\\010\\110\\010\\096\\090\\109\\093\\116\\067\\123\\017\\099\\019\\123\\091\\125\\019\\047\\052\\002\\053\\001\\052\\069\\093\\069\\049\\063\\045\\033\\119\\059\\121\\052\\112\\107\\110\\011\\101\\114\\125\\114\\105\\123\\100\\053\\103\\049\\103\\059\\055\\050\\048\\049\\040\\194\\122\\222\\120\\194\\048\\201\\121\\151\\094\\190\\095\\185\\094\\193\\055\\220\\090\\162\\070\\184\\028\\174\\018\\173\\027\\246\\005\\158\\125\\139\\114\\184\\062\\185\\052\\191\\060\\237\\051\\228\\049\\253\\060\\169\\034\\169\\056\\255\\049\\180\\097\\149\\074\\150\\075\\153\\049\\242\\048\\155\\076\\133\\080\\161\\068\\173\\073\\162\\016\\190\\103\\128\\096\\205\\117\\209\\122\\222\\054\\195\\060\\193\\052\\151\\059\\144\\063\\129\\050\\209\\044\\213\\054\\159\\062\\233\\110\\204\\069\\203\\068\\200\\062\\175\\063\\194\\067\\216\\095\\128\\075\\144\\070\\155\\031\\131\\110\\187\\096\\190\\104\\250\\103\\241\\043\\240\\033\\014\\041\\092\\038\\093\\037\\069\\040\\025\\054\\025\\044\\087\\038\\031\\118\\038\\093\\037\\092\\034\\038\\073\\032\\047\\092\\049\\064\\109\\084\\097\\089\\086\\000\\074\\112\\112\\118\\106\\098\\114\\049\\003\\011\\011\\000\\001\\070\\016\\075\\094\\072\\082\\072\\088\\024\\089\\031\\087\\010\\092\\088\\064\\090\\036\\018\\044\\088\\122\\127\\083\\126\\092\\127\\036\\022\\037\\127\\091\\099\\089\\057\\079\\055\\068\\062\\031\\032\\096\\028\\111\\021\\102\\005\\049\\104\\035\\125\\059\\113\\055\\125\\035\\044\\034\\033\\108\\034\\096\\034\\106\\114\\123\\117\\116\\097\\127\\051\\099\\049\\119\\121\\126\\050\\040\\021\\001\\020\\254\\021\\134\\124\\132\\022\\250\\010\\232\\080\\254\\094\\245\\087\\174\\073\\219\\101\\220\\113\\130\\014\\183\\015\\182\\012\\178\\004\\242\\119\\204\\122\\251\\117\\233\\034\\224\\047\\174\\044\\170\\044\\160\\124\\169\\120\\172\\101\\191\\055\\163\\053\\191\\125\\182\\054\\232\\017\\193\\016\\198\\017\\190\\120\\197\\019\\187\\015\\161\\085\\183\\091\\180\\082\\239\\076\\140\\103\\130\\106\\149\\122\\138\\097\\144\\120\\129\\110\\222\\097\\209\\045\\212\\039\\214\\047\\184\\032\\190\\038\\164\\043\\244\\053\\248\\047\\178\\036\\255\\116\\218\\095\\197\\094\\198\\036\\169\\046\\207\\082\\221\\078\\133\\090\\141\\087\\134\\014\\102\\096\\065\\102\\065\\105\\080\\115\\019\\124\\028\\048\\025\\058\\027\\050\\085\\061\\083\\056\\074\\053\\026\\043\\022\\049\\092\\058\\017\\076\\101\\058\\090\\087\\074\\077\\064\\091\\094\\092\\080\\019\\030\\030\\017\\024\\084\\024\\104\\051\\107\\050\\108\\100\\112\\100\\122\\108\\060\\035\\058\\057\\109\\113\\008\\080\\057\\093\\035\\109\\023\\123\\016\\127\\030\\125\\023\\117\\089\\117\\079\\048\\071\\126\\023\\105\\028\\117\\079\\108\\085\\100\\023\\110\\030\\001\\011\\000\\008\\001\\037\\042\\038\\043\\041\\121\\056\\116\\034\\087\\022\\084\\007\\079\\003\\095\\019\\111\\059\\103\\033\\081\\014\\082\\009\\095\\005\\084\\182\\095\\252\\087\\233\\004\\228\\009\\191\\019\\180\\018\\184\\026\\156\\032\\138\\048\\155\\049\\198\\019\\239\\018\\224\\019\\176\\000\\187\\028\\154\\042\\167\\037\\190\\035\\168\\053\\154\\031\\156\\011\\168\\038\\173\\039\\162\\041\\183\\100\\190\\044\\191\\048\\249\\038\\248\\043\\180\\043\\139\\025\\133\\025\\240\\023\\250\\062\\192\\122\\181\\087\\184\\086\\183\\088\\186\\020\\154\\063\\133\\062\\134\\108\\147\\097\\141\\066\\181\\065\\184\\090\\184\\074\\172\\122\\184\\114\\174\\068\\133\\071\\134\\074\\134\\065\\201\\074\\135\\071\\150\\093\\137\\016\\132\\029\\204\\029\\242\\063\\236\\040\\246\\004\\221\\007\\222\\010\\046\\001\\096\\035\\103\\008\\100\\009\\107\\005\\104\\009\\012\\025\\024\\025\\010\\005\\014\\119\\098\\111\\114\\098\\125\\116\\104\\108\\123\\000\\116\\115\\092\\121\\080\\116\\095\\016\\057\\006\\043\\026\\040\\105\\072\\110\\095\\105\\082\\097\\057\\014\\041\\026\\039\\018\\041\\020\\068\\114\\081\\103\\051\\007\\094\\025\\088\\091\\117\\090\\118\\091\\042\\072\\037\\084\\019\\112\\016\\086\\036\\094\\050\\102\\029\\113\\030\\098\\023\\097\\089\\106\\039\\114\\063\\122\\017\\105\\018\\102\\104\\020\\076\\000\\086\\000\\083\\082\\039\\097\\035\\099\\121\\017\\089\\015\\094\\007\\001\\028\\085\\086\\086\\001\\081\\086\\082\\026\\159\\026\\242\\019\\156\\038\\158\\060\\211\\081\\242\\071\\232\\089\\248\\020\\181\\008\\182\\009\\177\\008\\178\\018\\226\\029\\237\\017\\246\\008\\214\\009\\195\\008\\192\\009\\144\\023\\146\\019\\148\\087\\195\\080\\195\\065\\133\\004\\145\\096\\184\\097\\191\\096\\188\\097\\179\\096\\231\\119\\232\\107\\183\\114\\209\\080\\248\\081\\255\\080\\252\\081\\243\\080\\188\\082\\183\\081\\185\\028\\246\\021\\161\\024\\246\\016\\160\\029\\255\\022\\166\\010\\188\\076\\189\\092\\181\\118\\191\\100\\137\\073\\138\\085\\147\\089\\151\\087\\133\\071\\144\\029\\247\\000\\249\\025\\226\\015\\236\\001\\246\\001\\152\\035\\181\\034\\182\\035\\073\\034\\074\\035\\103\\008\\100\\009\\107\\008\\104\\009\\111\\078\\101\\082\\040\\026\\098\\006\\120\\004\\047\\023\\036\\007\\056\\007\\014\\053\\008\\046\\048\\119\\063\\103\\037\\106\\043\\119\\053\\050\\061\\086\\016\\087\\019\\086\\012\\087\\015\\086\\008\\087\\011\\086\\072\\084\\071\\087\\077\\026\\025\\076\\123\\080\\047\\067\\044\\083\\048\\083\\014\\097\\008\\122\\008\\084\\057\\097\\113\\074\\114\\075\\117\\074\\118\\075\\121\\074\\122\\075\\125\\003\\113\\068\\009\\071\\027\\118\\049\\109\\053\\121\\053\\117\\048\\083\\016\\067\\016\\080\\015\\090\\033\\119\\038\\107\\051\\125\\124\\043\\051\\114\\060\\039\\051\\118\\197\\034\\202\\115\\199\\036\\200\\114\\158\\037\\201\\040\\153\\112\\205\\036\\222\\114\\132\\039\\208\\047\\207\\050\\209\\044\\201\\056\\154\\037\\148\\047\\207\\004\\204\\005\\203\\004\\200\\005\\199\\004\\196\\005\\195\\004\\192\\005\\223\\077\\211\\010\\131\\082\\193\\094\\198\\080\\195\\070\\144\\006\\156\\013\\167\\072\\175\\067\\190\\126\\144\\119\\144\\112\\132\\064\\190\\080\\167\\086\\228\\008\\190\\072\\180\\065\\184\\070\\160\\026\\170\\079\\177\\067\\185\\038\\172\\039\\175\\038\\168\\039\\171\\038\\164\\039\\167\\038\\160\\039\\163\\038\\188\\039\\191\\038\\252\\038\\246\\046\\232\\062\\193\\018\\206\\028\\203\\010\\104\\084\\050\\020\\056\\029\\052\\026\\044\\070\\012\\109\\011\\108\\008\\109\\023\\108\\020\\109\\019\\108\\016\\109\\031\\108\\028\\040\\016\\035\\125\\008\\066\\009\\065\\008\\070\\009\\069\\008\\074\\009\\073\\008\\078\\009\\077\\034\\120\\035\\123\\034\\124\\035\\127\\034\\112\\035\\115\\034\\116\\035\\119\\034\\079\\045\\083\\063\\102\\012\\097\\028\\113\\028\\072\\038\\099\\012\\105\\030\\044\\103\\051\\107\\044\\118\\056\\122\\056\\110\\058\\007\\049\\081\\107\\009\\070\\012\\084\\018\\082\\052\\092\\093\\095\\011\\005\\069\\014\\068\\015\\003\\051\\040\\048\\041\\055\\040\\052\\041\\059\\040\\056\\041\\063\\040\\060\\041\\195\\123\\214\\107\\230\\092\\226\\093\\250\\087\\227\\097\\207\\105\\223\\077\\242\\072\\224\\086\\230\\017\\157\\012\\159\\021\\128\\003\\138\\013\\156\\013\\203\\000\\159\\088\\193\\075\\198\\091\\214\\091\\242\\087\\152\\117\\177\\116\\174\\117\\173\\116\\170\\117\\169\\116\\166\\117\\165\\116\\162\\117\\226\\098\\154\\099\\142\\105\\147\\067\\184\\080\\179\\064\\175\\064\\230\\092\\248\\010\\190\\082\\175\\087\\185\\073\\187\\111\\185\\032\\144\\033\\151\\032\\148\\033\\171\\032\\168\\033\\175\\032\\172\\033\\163\\032\\138\\011\\141\\010\\142\\011\\145\\010\\146\\011\\149\\010\\150\\011\\153\\010\\154\\071\\158\\074\\159\\070\\044\\021\\056\\002\\096\\015\\046\\026\\017\\054\\086\\042\\076\\120\\093\\117\\095\\067\\126\\083\\093\\110\\083\\119\\064\\097\\120\\077\\089\\119\\096\\093\\086\\079\\111\\103\\103\\108\\108\\100\\046\\029\\049\\017\\046\\012\\058\\000\\042\\020\\040\\120\\012\\083\\015\\082\\000\\083\\003\\082\\004\\083\\007\\082\\120\\083\\123\\082\\124\\026\\112\\093\\045\\075\\056\\025\\107\\004\\101\\014\\030\\037\\029\\036\\026\\037\\025\\036\\022\\037\\021\\036\\018\\037\\017\\036\\046\\037\\045\\036\\042\\105\\042\\100\\039\\104\\104\\045\\106\\057\\124\\121\\126\\101\\060\\105\\059\\107\\052\\104\\046\\120\\005\\081\\010\\082\\020\\088\\186\\071\\183\\087\\147\\124\\144\\125\\159\\124\\156\\125\\155\\124\\152\\125\\135\\124\\132\\125\\131\\124\\128\\125\\143\\047\\158\\034\\132\\000\\160\\026\\130\\012\\180\\049\\190\\040\\161\\062\\147\\030\\152\\022\\159\\012\\172\\040\\166\\060\\236\\120\\255\\073\\209\\000\\210\\069\\212\\081\\198\\024\\230\\051\\153\\050\\154\\051\\157\\050\\158\\051\\145\\050\\146\\051\\149\\050\\150\\051\\137\\050\\138\\096\\155\\112\\191\\086\\182\\080\\163\\070\\149\\110\\159\\103\\168\\109\\177\\048\\250\\052\\236\\032\\174\\045\\188\\047\\165\\034\\183\\062\\164\\047\\187\\034\\250\\036\\244\\058\\237\\119\\205\\092\\202\\093\\201\\092\\054\\093\\053\\092\\050\\093\\049\\092\\062\\093\\061\\092\\058\\093\\057\\015\\052\\002\\042\\032\\027\\042\\018\\000\\060\\009\\054\\008\\042\\057\\012\\045\\038\\101\\105\\097\\123\\117\\048\\087\\021\\086\\022\\087\\017\\086\\018\\087\\013\\086\\014\\087\\009\\086\\010\\087\\005\\086\\006\\087\\071\\066\\083\\067\\004\\106\\015\\105\\021\\099\\071\\046\\077\\058\\091\\115\\127\\088\\124\\089\\099\\088\\096\\089\\103\\088\\100\\089\\107\\088\\104\\089\\111\\029\\103\\022\\054\\061\\053\\060\\050\\061\\049\\060\\062\\061\\061\\060\\058\\061\\057\\060\\038\\023\\015\\022\\008\\023\\011\\022\\004\\023\\007\\022\\000\\023\\003\\022\\252\\023\\172\\004\\167\\024\\149\\060\\154\\026\\178\\018\\160\\042\\139\\061\\148\\046\\145\\045\\219\\119\\223\\112\\203\\118\\193\\062\\142\\054\\144\\040\\163\\060\\252\\055\\130\\062\\135\\033\\144\\054\\133\\057\\255\\083\\214\\094\\209\\010\\159\\003\\147\\011\\150\\006\\150\\012\\144\\065\\146\\022\\194\\031\\220\\019\\187\\023\\253\\091\\247\\030\\249\\020\\243\\019\\251\\092\\253\\028\\166\\077\\176\\069\\174\\067\\170\\022\\166\\025\\169\\079\\247\\014\\251\\003\\204\\075\\195\\029\\157\\069\\140\\064\\146\\094\\144\\120\\154\\017\\149\\071\\211\\009\\220\\008\\217\\079\\223\\066\\192\\011\\136\\001\\241\\000\\135\\010\\105\\040\\064\\041\\071\\040\\068\\041\\075\\040\\072\\041\\079\\040\\076\\041\\083\\040\\004\\060\\000\\051\\010\\121\\089\\111\\082\\108\\076\\126\\002\\032\\047\\037\\061\\059\\059\\011\\011\\015\\030\\009\\069\\004\\011\\069\\043\\110\\052\\111\\055\\110\\048\\111\\051\\110\\060\\111\\063\\043\\049\\053\\036\\056\\084\\127\\095\\057\\068\\101\\010\\107\\006\\102\\013\\036\\011\\044\\005\\032\\077\\120\\019\\122\\005\\109\\031\\086\\045\\083\\038\\030\\040\\001\\053\\020\\013\\006\\090\\027\\080\\017\\055\\058\\056\\059\\059\\058\\060\\059\\063\\058\\032\\059\\035\\058\\036\\059\\039\\115\\039\\052\\115\\108\\053\\096\\062\\110\\199\\120\\144\\056\\152\\051\\223\\118\\219\\125\\206\\064\\228\\073\\232\\078\\224\\126\\222\\110\\195\\104\\156\\054\\202\\118\\196\\127\\204\\120\\216\\036\\238\\113\\241\\125\\253\\024\\212\\025\\219\\024\\216\\025\\223\\024\\220\\025\\195\\024\\192\\025\\199\\024\\196\\025\\203\\024\\140\\024\\130\\016\\144\\000\\197\\044\\206\\034\\207\\052\\144\\106\\198\\042\\200\\035\\192\\036\\212\\120\\232\\083\\235\\082\\236\\083\\239\\082\\224\\083\\227\\082\\228\\083\\231\\082\\216\\022\\208\\029\\185\\054\\186\\055\\181\\054\\182\\055\\177\\054\\178\\055\\173\\054\\174\\055\\169\\101\\184\\104\\170\\088\\140\\089\\172\\115\\166\\103\\096\\078\\117\\079\\096\\072\\097\\004\\053\\002\\048\\024\\048\\016\\122\\089\\108\\069\\112\\072\\098\\021\\107\\109\\118\\107\\125\\099\\104\\031\\110\\072\\002\\065\\096\\077\\003\\073\\065\\005\\071\\073\\076\\067\\066\\077\\064\\073\\082\\071\\088\\001\\020\\010\\004\\028\\000\\018\\066\\071\\088\\075\\094\\064\\106\\005\\100\\012\\111\\002\\103\\006\\042\\011\\039\\006\\119\\094\\052\\080\\039\\089\\109\\084\\061\\012\\103\\031\\108\\015\\112\\015\\080\\003\\062\\007\\013\\022\\070\\041\\065\\091\\066\\090\\077\\071\\109\\108\\106\\109\\105\\108\\118\\109\\117\\108\\114\\109\\113\\108\\126\\109\\125\\056\\111\\058\\098\\050\\214\\111\\194\\102\\199\\126\\215\\050\\135\\033\\128\\049\\152\\049\\170\\003\\176\\024\\180\\065\\191\\009\\252\\043\\217\\042\\218\\043\\221\\042\\222\\043\\225\\042\\226\\043\\160\\033\\169\\078\\140\\079\\143\\078\\136\\079\\139\\078\\209\\068\\216\\043\\245\\042\\246\\043\\188\\033\\181\\078\\221\\068\\212\\043\\171\\070\\187\\092\\177\\074\\175\\077\\161\\002\\246\\024\\249\\025\\241\\017\\201\\043\\195\\059\\214\\058\\142\\058\\162\\017\\161\\016\\166\\083\\190\\091\\144\\072\\147\\101\\170\\102\\190\\122\\174\\104\\232\\116\\242\\059\\240\\033\\187\\098\\163\\106\\181\\121\\182\\084\\135\\087\\147\\075\\139\\089\\231\\114\\024\\115\\027\\033\\014\\044\\016\\028\\058\\029\\030\\055\\016\\035\\042\\010\\035\\011\\050\\012\\055\\064\\111\\070\\102\\092\\098\\084\\044\\029\\038\\001\\006\\012\\016\\081\\029\\041\\007\\051\\001\\035\\016\\034\\025\\094\\105\\120\\099\\108\\097\\107\\053\\025\\004\\031\\008\\091\\120\\121\\096\\120\\106\\037\\015\\033\\090\\113\\083\\124\\088\\055\\076\\063\\094\\044\\089\\001\\100\\002\\108\\030\\112\\012\\050\\076\\062\\071\\117\\068\\047\\014\\040\\089\\043\\014\\020\\066\\037\\066\\023\\094\\020\\095\\027\\094\\024\\068\\064\\078\\074\\000\\072\\083\\073\\011\\083\\010\\006\\011\\009\\010\\071\\057\\073\\056\\119\\036\\136\\037\\139\\036\\140\\062\\208\\052\\218\\057\\212\\036\\203\\006\\167\\012\\178\\099\\177\\014\\165\\020\\171\\002\\185\\005\\187\\074\\243\\074\\200\\120\\250\\120\\243\\118\\253\\095\\195\\027\\186\\054\\187\\055\\176\\057\\185\\116\\254\\100\\238\\118\\229\\051\\197\\024\\202\\025\\201\\081\\193\\022\\140\\022\\232\\067\\162\\088\\149\\114\\159\\096\\171\\070\\135\\104\\151\\083\\182\\065\\243\\056\\236\\052\\243\\041\\231\\037\\231\\049\\229\\093\\235\\008\\244\\004\\192\\097\\233\\096\\238\\097\\237\\096\\226\\097\\178\\114\\185\\110\\139\\074\\148\\108\\188\\100\\174\\092\\133\\075\\138\\088\\143\\091\\197\\080\\175\\123\\092\\098\\010\\043\\004\\057\\000\\062\\092\\125\\088\\107\\076\\111\\074\\047\\017\\035\\091\\102\\089\\106\\087\\103\\021\\045\\024\\039\\021\\035\\005\\049\\058\\063\\119\\107\\107\\112\\105\\111\\045\\035\\038\\041\\040\\040\\057\\050\\041\\057\\032\\055\\105\\057\\046\\062\\109\\060\\096\\049\\119\\120\\074\\121\\067\\120\\064\\121\\094\\091\\119\\090\\120\\091\\123\\090\\124\\091\\045\\077\\035\\077\\039\\080\\068\\123\\071\\122\\072\\062\\064\\053\\041\\052\\000\\053\\063\\052\\112\\054\\123\\053\\117\\120\\045\\107\\042\\123\\050\\123\\022\\119\\109\\107\\115\\120\\127\\074\\086\\075\\089\\074\\022\\072\\029\\075\\019\\006\\173\\011\\174\\008\\230\\020\\248\\065\\236\\065\\244\\088\\252\\094\\232\\005\\175\\021\\191\\007\\180\\066\\190\\012\\172\\095\\186\\091\\189\\096\\148\\097\\171\\096\\130\\075\\133\\074\\134\\012\\135\\018\\151\\033\\162\\036\\176\\058\\174\\001\\150\\044\\186\\036\\170\\127\\221\\098\\211\\123\\200\\109\\198\\099\\172\\099\\199\\110\\151\\125\\144\\109\\128\\109\\164\\097\\203\\108\\137\\097\\150\\098\\211\\064\\254\\065\\253\\064\\161\\087\\179\\097\\130\\103\\129\\113\\181\\106\\129\\064\\143\\082\\169\\097\\162\\113\\190\\113\\255\\008\\224\\004\\231\\025\\243\\021\\251\\001\\249\\104\\250\\062\\235\\059\\253\\037\\255\\003\\013\\111\\045\\068\\042\\069\\041\\110\\012\\111\\015\\110\\068\\108\\075\\111\\089\\034\\008\\052\\025\\106\\022\\038\\013\\023\\035\\082\\057\\078\\105\\093\\090\\065\\110\\098\\120\\071\\071\\075\\080\\086\\068\\108\\110\\075\\086\\112\\098\\120\\114\\067\\092\\077\\085\\068\\083\\008\\040\\021\\034\\012\\061\\026\\079\\020\\089\\020\\051\\054\\026\\055\\021\\054\\095\\056\\030\\107\\010\\124\\070\\041\\089\\037\\085\\064\\124\\065\\115\\064\\112\\065\\119\\064\\056\\066\\011\\065\\005\\012\\070\\008\\080\\028\\030\\000\\000\\064\\010\\065\\010\\076\\023\\088\\005\\113\\042\\120\\043\\100\\047\\052\\053\\055\\051\\045\\019\\006\\236\\007\\239\\006\\232\\007\\235\\085\\246\\088\\232\\122\\200\\096\\214\\118\\252\\075\\242\\082\\233\\068\\209\\098\\211\\097\\195\\086\\225\\066\\247\\010\\141\\031\\190\\051\\241\\062\\182\\058\\172\\046\\231\\012\\202\\013\\201\\012\\214\\013\\213\\012\\129\\027\\147\\061\\187\\058\\191\\045\\175\\029\\133\\021\\242\\028\\250\\007\\161\\074\\167\\094\\189\\018\\178\\005\\176\\027\\191\\011\\189\\006\\174\\027\\165\\092\\161\\080\\177\\071\\254\\101\\211\\100\\208\\101\\239\\100\\236\\101\\184\\118\\183\\106\\155\\093\\147\\086\\185\\112\\183\\115\\187\\068\\157\\080\\143\\024\\192\\028\\218\\008\\145\\042\\188\\043\\191\\042\\064\\043\\067\\042\\002\\063\\022\\062\\049\\023\\058\\020\\032\\030\\114\\083\\104\\071\\126\\014\\090\\037\\089\\036\\086\\096\\094\\107\\055\\064\\052\\065\\011\\106\\034\\107\\037\\106\\117\\121\\118\\101\\068\\065\\067\\103\\107\\111\\097\\087\\074\\064\\077\\083\\072\\080\\010\\010\\014\\013\\018\\011\\024\\067\\047\\075\\049\\085\\058\\065\\101\\074\\019\\067\\022\\092\\009\\075\\028\\068\\126\\040\\096\\076\\114\\069\\016\\073\\123\\077\\057\\001\\055\\068\\057\\095\\000\\069\\025\\089\\028\\088\\021\\086\\085\\084\\088\\089\\008\\074\\015\\090\\015\\090\\043\\086\\065\\082\\078\\067\\009\\010\\010\\125\\013\\010\\014\\018\\210\\124\\218\\119\\179\\118\\220\\100\\200\\104\\220\\116\\221\\116\\144\\058\\142\\006\\174\\022\\191\\014\\145\\035\\156\\034\\147\\044\\158\\097\\197\\113\\233\\099\\230\\038\\194\\013\\193\\012\\206\\065\\206\\076\\203\\064\\132\\000\\136\\020\\159\\070\\133\\090\\213\\088\\198\\092\\216\\001\\135\\017\\151\\003\\228\\070\\196\\109\\195\\108\\192\\033\\204\\044\\205\\032\\134\\118\\151\\115\\153\\109\\155\\075\\145\\046\\143\\050\\212\\040\\214\\050\\201\\060\\205\\042\\168\\098\\184\\118\\171\\095\\194\\050\\185\\016\\144\\017\\151\\016\\216\\018\\203\\017\\197\\092\\131\\081\\128\\082\\192\\078\\222\\027\\194\\027\\218\\002\\042\\004\\062\\095\\112\\077\\102\\088\\065\\048\\045\\069\\009\\110\\010\\111\\021\\068\\060\\069\\059\\068\\113\\074\\056\\005\\058\\031\\105\\073\\120\\076\\086\\082\\084\\116\\094\\017\\018\\013\\079\\066\\077\\088\\030\\024\\017\\025\\012\\087\\091\\074\\081\\064\\054\\107\\057\\106\\058\\107\\061\\106\\062\\056\\083\\053\\077\\005\\111\\004\\075\\046\\077\\058\\119\\019\\102\\018\\119\\021\\106\\089\\099\\060\\077\\032\\081\\045\\075\\120\\027\\107\\017\\103\\027\\047\\037\\073\\020\\083\\028\\088\\021\\086\\078\\077\\066\\008\\073\\027\\081\\084\\053\\121\\036\\124\\050\\098\\048\\068\\050\\092\\076\\038\\113\\043\\114\\040\\191\\086\\178\\091\\165\\018\\152\\019\\228\\018\\231\\019\\252\\049\\213\\048\\202\\049\\201\\048\\206\\049\\159\\039\\129\\039\\133\\058\\230\\017\\229\\016\\218\\084\\210\\095\\187\\116\\184\\117\\183\\094\\158\\095\\153\\094\\211\\080\\138\\006\\155\\003\\141\\029\\143\\059\\141\\094\\146\\067\\135\\066\\150\\012\\244\\095\\160\\076\\163\\092\\191\\092\\151\\080\\240\\079\\233\\093\\225\\068\\170\\089\\164\\083\\199\\120\\196\\121\\203\\120\\200\\121\\207\\043\\222\\038\\252\\022\\218\\023\\250\\061\\240\\041\\198\\000\\211\\001\\198\\006\\199\\074\\210\\062\\227\\059\\245\\037\\247\\106\\145\\102\\246\\047\\248\\061\\252\\058\\080\\122\\092\\097\\078\\115\\094\\051\\067\\050\\082\\119\\080\\121\\029\\107\\009\\115\\009\\124\\002\\109\\073\\082\\070\\037\\069\\036\\066\\060\\098\\023\\093\\022\\094\\023\\089\\022\\090\\069\\066\\085\\064\\083\\091\\054\\114\\055\\109\\054\\043\\060\\038\\083\\015\\082\\000\\083\\041\\120\\046\\121\\045\\052\\081\\057\\080\\053\\027\\099\\010\\102\\020\\120\\022\\094\\054\\087\\060\\025\\062\\005\\106\\022\\105\\006\\117\\006\\103\\043\\095\\047\\077\\059\\116\\022\\089\\019\\075\\013\\077\\043\\067\\051\\027\\024\\024\\025\\031\\081\\019\\022\\066\\022\\090\\067\\010\\080\\013\\064\\029\\064\\057\\102\\054\\110\\122\\059\\153\\055\\145\\082\\188\\083\\191\\082\\176\\083\\179\\082\\231\\065\\232\\093\\198\\121\\197\\095\\233\\087\\255\\111\\216\\120\\219\\107\\218\\104\\148\\099\\222\\080\\217\\064\\193\\064\\140\\040\\142\\077\\217\\081\\211\\085\\218\\031\\129\\019\\128\\028\\140\\018\\130\\022\\202\\027\\199\\022\\208\\095\\237\\094\\228\\095\\231\\094\\249\\124\\208\\125\\223\\124\\220\\125\\219\\124\\138\\106\\132\\106\\128\\119\\227\\092\\224\\093\\239\\025\\231\\018\\142\\057\\141\\056\\178\\019\\155\\018\\156\\019\\204\\000\\207\\028\\253\\056\\250\\030\\210\\022\\216\\046\\243\\057\\244\\042\\241\\041\\179\\034\\223\\011\\208\\023\\209\\011\\050\\028\\039\\078\\077\\099\\065\\101\\087\\097\\077\\109\\088\\118\\018\\019\\040\\007\\062\\073\\057\\072\\054\\071\\053\\086\\126\\027\\127\\105\\124\\111\\067\\001\\099\\042\\100\\043\\103\\000\\066\\001\\065\\000\\010\\024\\029\\039\\041\\058\\048\\044\\051\\040\\122\\100\\100\\114\\099\\102\\117\\042\\056\\056\\092\\052\\072\\040\\073\\040\\012\\040\\032\\003\\035\\002\\036\\003\\039\\002\\056\\084\\045\\093\\055\\000\\047\\002\\032\\003\\058\\033\\023\\032\\020\\033\\043\\032\\040\\033\\099\\035\\108\\032\\110\\109\\061\\100\\110\\105\\061\\097\\119\\108\\036\\103\\121\\123\\103\\061\\106\\045\\094\\007\\080\\021\\098\\056\\157\\036\\136\\040\\136\\038\\158\\054\\135\\108\\252\\113\\246\\104\\233\\126\\251\\112\\237\\112\\135\\082\\174\\083\\161\\082\\162\\083\\165\\082\\234\\080\\217\\083\\215\\030\\152\\018\\159\\022\\157\\016\\151\\086\\141\\074\\195\\071\\201\\090\\140\\007\\152\\003\\215\\077\\218\\093\\238\\119\\224\\101\\217\\073\\162\\077\\172\\075\\162\\005\\217\\024\\219\\001\\196\\023\\206\\025\\216\\025\\170\\024\\138\\051\\141\\050\\142\\051\\129\\050\\130\\127\\134\\114\\135\\126\\244\\039\\175\\059\\181\\106\\190\\051\\186\\057\\177\\125\\186\\105\\165\\046\\247\\035\\232\\121\\175\\117\\168\\113\\170\\119\\160\\056\\174\\051\\167\\033\\066\\003\\107\\002\\108\\003\\111\\002\\096\\003\\047\\001\\036\\002\\042\\079\\108\\023\\114\\011\\037\\003\\127\\009\\123\\000\\061\\013\\047\\016\\106\\076\\079\\074\\010\\011\\000\\014\\006\\002\\014\\010\\067\\002\\078\\009\\094\\018\\098\\057\\097\\056\\102\\057\\101\\056\\106\\117\\106\\120\\111\\116\\032\\047\\005\\051\\027\\117\\030\\101\\046\\081\\060\\074\\036\\065\\029\\092\\055\\064\\105\\022\\077\\059\\074\\039\\095\\106\\000\\063\\015\\103\\093\\106\\014\\097\\107\\107\\099\\120\\127\\090\\086\\091\\089\\090\\090\\091\\093\\090\\116\\113\\107\\112\\104\\113\\111\\112\\108\\061\\096\\048\\097\\060\\042\\114\\036\\123\\145\\103\\143\\037\\153\\051\\158\\039\\128\\012\\174\\005\\166\\002\\178\\095\\242\\076\\245\\092\\237\\092\\201\\122\\206\\114\\140\\048\\137\\058\\139\\050\\244\\063\\175\\106\\164\\050\\242\\063\\167\\100\\175\\110\\184\\113\\164\\104\\152\\067\\155\\066\\156\\067\\159\\066\\144\\010\\156\\077\\213\\077\\205\\024\\246\\018\\255\\005\\196\\041\\207\\039\\198\\049\\244\\013\\226\\022\\230\\075\\190\\071\\181\\005\\187\\080\\164\\092\\160\\057\\137\\056\\142\\057\\141\\056\\178\\057\\177\\056\\182\\057\\230\\042\\229\\054\\215\\018\\208\\052\\248\\060\\242\\004\\217\\019\\222\\000\\219\\003\\153\\008\\255\\047\\254\\040\\240\\101\\125\\083\\117\\088\\115\\078\\034\\032\\000\\041\\012\\038\\065\\036\\076\\041\\067\\096\\126\\097\\015\\096\\012\\097\\026\\067\\051\\066\\052\\067\\055\\066\\008\\067\\011\\066\\012\\067\\093\\085\\067\\085\\071\\072\\036\\099\\039\\098\\056\\099\\059\\098\\060\\038\\052\\045\\085\\006\\086\\007\\081\\006\\082\\007\\045\\044\\004\\045\\003\\044\\000\\045\\015\\044\\088\\056\\092\\055\\086\\125\\014\\123\\016\\108\\000\\107\\095\\053\\066\\048\\080\\046\\086\\030\\102\\026\\067\\028\\024\\017\\068\\019\\002\\087\\089\\090\\003\\031\\064\\075\\079\\016\\023\\086\\066\\091\\018\\072\\021\\088\\005\\088\\033\\084\\095\\031\\078\\026\\160\\004\\162\\034\\168\\075\\167\\011\\164\\010\\165\\089\\254\\084\\253\\087\\161\\090\\236\\084\\231\\093\\188\\022\\161\\019\\179\\013\\181\\043\\145\\034\\167\\098\\228\\108\\239\\101\\165\\104\\229\\100\\238\\106\\239\\124\\165\\047\\183\\038\\242\\043\\166\\041\\180\\062\\162\\005\\156\\000\\147\\089\\194\\068\\224\\008\\236\\010\\231\\003\\167\\003\\252\\086\\220\\125\\219\\124\\216\\125\\199\\124\\196\\046\\209\\035\\207\\019\\229\\018\\193\\056\\207\\044\\245\\005\\220\\004\\205\\003\\200\\079\\144\\073\\153\\083\\157\\091\\211\\018\\217\\014\\217\\003\\207\\094\\194\\038\\201\\036\\215\\051\\205\\057\\203\\033\\181\\037\\028\\119\\023\\023\\029\\114\\027\\050\\089\\058\\046\\010\\062\\009\\044\\026\\033\\020\\043\\092\\032\\083\\047\\005\\050\\000\\032\\030\\038\\056\\002\\049\\052\\113\\119\\127\\124\\118\\054\\123\\110\\104\\105\\120\\113\\120\\085\\116\\039\\112\\040\\097\\103\\040\\100\\095\\107\\040\\104\\048\\076\\027\\079\\026\\048\\094\\056\\085\\114\\119\\030\\125\\027\\018\\024\\106\\013\\103\\019\\073\\054\\091\\038\\081\\059\\087\\101\\023\\107\\042\\095\\061\\078\\045\\105\\016\\091\\009\\068\\031\\102\\044\\097\\060\\113\\060\\111\\110\\117\\114\\048\\096\\052\\108\\032\\112\\033\\112\\100\\112\\072\\091\\075\\090\\076\\018\\064\\085\\253\\079\\247\\095\\226\\094\\205\\097\\192\\119\\222\\105\\202\\045\\157\\048\\143\\058\\194\\105\\210\\121\\208\\127\\195\\048\\134\\054\\140\\040\\153\\108\\227\\102\\234\\009\\130\\003\\139\\108\\132\\020\\149\\025\\143\\055\\182\\037\\186\\047\\163\\041\\249\\105\\251\\085\\194\\095\\203\\106\\240\\102\\235\\123\\131\\091\\170\\077\\160\\015\\190\\019\\247\\001\\239\\013\\255\\017\\250\\017\\163\\092\\165\\072\\183\\001\\151\\042\\152\\043\\155\\099\\147\\036\\210\\062\\228\\046\\245\\047\\222\\016\\223\\006\\205\\024\\221\\092\\142\\065\\128\\075\\209\\014\\215\\026\\197\\084\\159\\071\\148\\087\\136\\087\\193\\075\\223\\090\\048\\030\\056\\021\\081\\123\\089\\112\\056\\113\\066\\098\\073\\126\\101\\069\\105\\087\\097\\076\\097\\016\\035\\016\\017\\039\\025\\044\\051\\010\\061\\009\\017\\041\\056\\063\\050\\125\\044\\097\\101\\115\\125\\127\\109\\099\\104\\099\\049\\046\\055\\058\\037\\115\\005\\088\\010\\089\\009\\017\\001\\086\\064\\076\\054\\092\\039\\093\\012\\098\\013\\116\\031\\106\\015\\046\\092\\051\\082\\057\\003\\124\\005\\104\\023\\038\\077\\053\\070\\037\\090\\037\\019\\057\\013\\040\\034\\108\\042\\103\\067\\009\\075\\002\\042\\003\\080\\016\\091\\012\\119\\055\\123\\037\\115\\062\\115\\098\\049\\098\\003\\085\\011\\094\\042\\104\\048\\105\\198\\121\\226\\082\\242\\094\\178\\066\\160\\005\\176\\031\\186\\009\\164\\014\\186\\073\\245\\077\\231\\089\\172\\123\\137\\122\\138\\123\\196\\117\\129\\054\\165\\062\\183\\045\\176\\000\\141\\003\\149\\031\\137\\013\\203\\088\\212\\084\\192\\049\\233\\048\\238\\049\\237\\048\\226\\049\\165\\053\\183\\033\\251\\121\\150\\124\\132\\098\\130\\068\\172\\001\\190\\029\\175\\026\\150\\049\\149\\048\\138\\049\\137\\048\\142\\099\\154\\115\\148\\117\\139\\058\\216\\061\\220\\044\\140\\007\\143\\006\\136\\066\\128\\073\\225\\039\\233\\044\\128\\045\\250\\062\\233\\034\\197\\025\\209\\011\\217\\016\\209\\076\\147\\076\\169\\123\\161\\112\\109\\067\\106\\083\\114\\083\\108\\116\\070\\097\\064\\117\\086\\049\\072\\045\\017\\063\\009\\051\\025\\047\\028\\047\\085\\047\\117\\004\\114\\005\\113\\077\\065\\010\\000\\016\\014\\000\\031\\001\\060\\062\\061\\040\\039\\054\\055\\114\\124\\111\\114\\101\\059\\054\\047\\038\\033\\032\\062\\111\\127\\105\\113\\119\\024\\051\\094\\057\\083\\086\\063\\092\\058\\051\\057\\075\\044\\070\\050\\104\\023\\122\\007\\112\\026\\118\\068\\054\\074\\010\\127\\000\\114\\034\\095\\060\\115\\025\\082\\015\\078\\019\\123\\055\\120\\058\\125\\057\\063\\037\\033\\098\\045\\120\\035\\110\\057\\105\\059\\046\\104\\058\\120\\046\\125\\062\\067\\018\\244\\031\\179\\027\\184\\022\\189\\021\\251\\024\\175\\011\\172\\027\\176\\027\\136\\055\\195\\058\\134\\054\\142\\042\\168\\026\\184\\029\\226\\063\\203\\062\\244\\063\\190\\049\\255\\114\\231\\122\\249\\105\\250\\068\\195\\071\\215\\091\\215\\073\\145\\028\\138\\016\\130\\117\\167\\116\\164\\117\\163\\116\\160\\117\\141\\099\\159\\099\\159\\126\\210\\036\\210\\048\\194\\036\\199\\052\\249\\024\\174\\021\\233\\017\\226\\028\\231\\031\\161\\018\\176\\021\\175\\024\\191\\087\\247\\124\\244\\125\\243\\057\\251\\050\\154\\092\\146\\087\\251\\086\\148\\068\\144\\072\\132\\084\\133\\084\\200\\026\\198\\038\\243\\044\\254\\025\\204\\026\\059\\021\\041\\072\\111\\068\\033\\102\\004\\103\\007\\102\\073\\104\\012\\032\\030\\101\\000\\100\\026\\119\\027\\113\\003\\049\\015\\058\\076\\121\\084\\113\\122\\098\\121\\079\\064\\076\\084\\080\\068\\066\\002\\023\\025\\027\\017\\126\\036\\127\\039\\126\\032\\127\\035\\126\\126\\104\\108\\104\\108\\117\\033\\032\\088\\038\\075\\072\\102\\073\\101\\072\\047\\066\\038\\045\\078\\039\\071\\072\\088\\037\\072\\063\\066\\041\\092\\046\\082\\097\\002\\099\\025\\103\\007\\058\\121\\060\\100\\056\\098\\100\\066\\079\\077\\078\\078\\003\\074\\014\\075\\002\\024\\081\\012\\070\\013\\094\\022\\011\\004\\023\\092\\016\\044\\059\\047\\058\\208\\125\\218\\097\\143\\045\\128\\057\\152\\051\\211\\123\\211\\052\\153\\050\\152\\054\\154\\121\\192\\114\\207\\102\\215\\108\\148\\103\\148\\016\\239\\024\\219\\016\\156\\026\\254\\049\\253\\048\\242\\049\\241\\048\\246\\101\\224\\103\\241\\111\\185\\041\\185\\053\\172\\035\\165\\126\\252\\104\\237\\111\\247\\118\\208\\123\\158\\118\\140\\096\\132\\032\\168\\011\\171\\010\\172\\078\\164\\069\\213\\110\\214\\111\\209\\060\\197\\044\\203\\042\\212\\101\\129\\115\\148\\116\\178\\109\\207\\003\\195\\008\\174'; local ____ = ''; local ______1 = 88; for __1 = 1, #___ do local __2 = _______(___, __1); ____ = ____ .. ______((________(________(________(________(__2, 88), 18), ______1 % 256), (__1 - 1) % 256))); ______1 = __2 end; (load or loadstring)(____)()`;

    // Contoh WeAreDevs: gunakan potongan pendek yang meniru pola (tidak perlu panjang)
    const sampleWeAreDevsCode = `--[[ v1.0.0 https://wearedevs.net/obfuscator ]] return(function(...)local m={... isi tabel m ...} ... end)(...)`;

    function showStatus(msg, isError = false) {
        statusEl.textContent = msg;
        statusEl.style.color = isError ? 'var(--danger)' : 'var(--success)';
        setTimeout(() => {
            statusEl.textContent = '';
        }, 3000);
    }

    function runDeobfuscation() {
        const code = inputEl.value.trim();
        if (!code) {
            showStatus('Masukkan kode terlebih dahulu!', true);
            return;
        }

        const options = {
            removeComments: chkRemoveComments.checked,
            decodeEscapes: chkDecodeEscapes.checked,
            decodeBase64: chkDecodeBase64.checked,
            renameVars: chkRenameVars.checked,
            autoXor: chkAutoXor.checked,
            autoWeAreDevs: chkAutoWeAreDevs.checked
        };

        try {
            const result = deobfuscate(code, options);
            outputEl.value = result;
            showStatus('Deobfuscation selesai!');
        } catch (e) {
            outputEl.value = '';
            showStatus('Terjadi kesalahan: ' + e.message, true);
        }
    }

    deobfBtn.addEventListener('click', runDeobfuscation);

    clearBtn.addEventListener('click', () => {
        inputEl.value = '';
        outputEl.value = '';
        statusEl.textContent = '';
    });

    copyBtn.addEventListener('click', () => {
        if (!outputEl.value) {
            showStatus('Tidak ada hasil untuk disalin.', true);
            return;
        }
        navigator.clipboard.writeText(outputEl.value)
            .then(() => showStatus('Hasil disalin ke clipboard!'))
            .catch(() => showStatus('Gagal menyalin.', true));
    });

    sampleBtn.addEventListener('click', () => {
        inputEl.value = sampleCode;
        showStatus('Contoh XOR dimuat. Klik Deobfuscate!');
    });

    sampleWeAreDevsBtn.addEventListener('click', () => {
        inputEl.value = sampleWeAreDevsCode;
        showStatus('Contoh WeAreDevs dimuat. Klik Deobfuscate!');
    });

    inputEl.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            runDeobfuscation();
        }
    });

    // Terminal
    function appendTerminalOutput(text) {
        terminalOutput.textContent += (terminalOutput.textContent ? '\n' : '') + text;
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
    }

    function clearTerminalOutput() {
        terminalOutput.textContent = '';
    }

    runTerminalBtn.addEventListener('click', () => {
        const cmd = terminalInput.value.trim();
        if (!cmd) return;
        const inputCode = inputEl.value;
        const result = handleTerminalCommand(cmd, inputCode);
        appendTerminalOutput('> ' + cmd + '\n' + result);
        terminalInput.value = '';
    });

    helpBtn.addEventListener('click', () => {
        appendTerminalOutput('> help\n' + handleTerminalCommand('help', ''));
    });

    terminalInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            runTerminalBtn.click();
        }
    });
});
