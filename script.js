"use strict";

// DOM Elements
const codeInput = document.getElementById('codeInput');
const languageSelect = document.getElementById('languageSelect');
const formattedCode = document.querySelector('#formattedCode code');
const fileInput = document.getElementById('fileInput');
const browseButton = document.getElementById('browseButton');
const formatButton = document.getElementById('formatButton');
const copyButton = document.getElementById('copyButton');
const loading = document.getElementById('loading');
const toast = document.getElementById('toast');
const livePreviewFrame = document.getElementById('livePreview'); // For live preview
const themeToggle = document.getElementById('themeToggle'); // For dark mode toggle

// Global variable for Pyodide instance (if needed for Python execution)
let pyodideInstance = null;

// Formatter Configuration (supports HTML, JavaScript, C, PL/SQL, Python, CSS)
const formatters = {
  html: { format: formatHTML, language: 'html' },
  javascript: { format: formatJavaScript, language: 'javascript' },
  c: { format: formatC, language: 'c' },
  plsql: { format: formatPLSQL, language: 'sql' },
  python: { format: formatPython, language: 'python' },
  css: { format: formatCSS, language: 'css' }
};

// -------------------- PL/SQL Formatter --------------------
function formatPLSQL(code) {
  code = code.replace(/;/g, ';\n');
  let { protectedCode, literals } = protectStringLiterals(code);
  protectedCode = protectedCode.replace(
    /(\b(?:begin|declare|type|record|is|when|then|case|else|end|exception|number|varchar2|date|boolean|dbms_output\.put_line))(?=[\s,;(])/gi,
    match => match.toUpperCase()
  );
  protectedCode = protectedCode.replace(/\/\s*$/, '/');
  code = restoreStringLiterals(protectedCode, literals);
  let indentLevel = 0;
  const indentSize = 4;
  const lines = code.split('\n');
  let output = [];
  let inRecord = false;
  lines.forEach(line => {
    line = line.trim();
    if (!line) return;
    if (line.startsWith('END') || (line.startsWith(');') && inRecord)) {
      indentLevel = Math.max(indentLevel - 1, 0);
      if (line.startsWith(');')) inRecord = false;
    }
    const indent = ' '.repeat(indentLevel * indentSize);
    output.push(indent + line);
    if (line.includes('RECORD (') || line.endsWith('BEGIN')) {
      indentLevel++;
      if (line.includes('RECORD (')) inRecord = true;
    }
  });
  let formattedOutput = output.join('\n');
  formattedOutput = formattedOutput.replace(/^DECLARE/gm, 'DECLARE\n');
  formattedOutput = formattedOutput.replace(/(BEGIN)/g, '\n$1\n\n');
  formattedOutput = formattedOutput.replace(/\n{3,}/g, '\n\n');
  formattedOutput = formattedOutput.replace(/\s*:=\s*/g, ' := ');
  formattedOutput = formattedOutput.replace(/\s*\|\|\s*/g, ' || ');
  return formattedOutput;
}

function protectStringLiterals(code) {
  const literals = [];
  const protectedCode = code.replace(/'([^']*)'/g, (match) => {
    literals.push(match);
    return `__LITERAL_${literals.length - 1}__`;
  });
  return { protectedCode, literals };
}

function restoreStringLiterals(code, literals) {
  literals.forEach((literal, i) => {
    const placeholder = new RegExp(`__LITERAL_${i}__`, 'g');
    code = code.replace(placeholder, literal);
  });
  return code;
}

// -------------------- Optimized HTML Formatter --------------------
// Builds formatted output line-by-line and collapses extra blank lines.
function formatHTML(code) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(code, 'text/html');
  let lines = [];

  function processNode(node, indentLevel) {
    const indent = ' '.repeat(indentLevel * 4);
    if (node.nodeType === Node.DOCUMENT_TYPE_NODE) {
      lines.push(`<!DOCTYPE ${node.name}>`);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = node.tagName.toLowerCase();
      const voidElements = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];
      const isVoid = voidElements.includes(tagName);
      let openTag = `${indent}<${tagName}`;
      Array.from(node.attributes).forEach(attr => {
        openTag += ` ${attr.name}="${attr.value}"`;
      });
      openTag += `>`;
      const children = Array.from(node.childNodes).filter(n => n.nodeType !== Node.COMMENT_NODE);
      const isTextOnly = children.every(n => n.nodeType === Node.TEXT_NODE);
      if (isVoid) {
        lines.push(openTag);
      } else if (isTextOnly && children.length > 0) {
        const textContent = children.map(n => n.textContent.trim()).join(" ");
        lines.push(`${openTag}${textContent}</${tagName}>`);
      } else if (children.length === 0) {
        lines.push(`${openTag}</${tagName}>`);
      } else {
        lines.push(openTag);
        children.forEach(child => processNode(child, indentLevel + 1));
        lines.push(`${indent}</${tagName}>`);
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      if (text) {
        lines.push(`${indent}${text}`);
      }
    }
  }

  Array.from(doc.childNodes).forEach(node => processNode(node, 0));
  // Collapse multiple blank lines into one
  return lines.join("\n").replace(/\n\s*\n/g, "\n");
}

// -------------------- CSS Formatter --------------------
function formatCSS(css) {
  return css.split('}')
    .map(rule => {
      const [selector, properties] = rule.split('{');
      if (!selector || !properties) return '';
      return `${selector.trim()} {\n${properties
        .split(';')
        .filter(p => p.trim())
        .map(p => {
          const [key, val] = p.split(':').map(s => s.trim());
          return key ? `  ${key}: ${val};` : '';
        })
        .join('\n')}\n}`;
    })
    .join('\n\n')
    .trim();
}

// -------------------- JavaScript Formatter --------------------
function formatJavaScript(code) {
  try {
    const ast = esprima.parse(code, { tolerant: true });
    return escodegen.generate(ast, {
      format: { indent: { style: '  ', base: 0 }, newline: '\n' }
    });
  } catch (error) {
    return `JavaScript Error: ${error.message}`;
  }
}

// -------------------- C Formatter --------------------
function formatC(code) {
  return code.split(';')
    .map(line => line.trim())
    .filter(line => line)
    .join(';\n') + ';';
}

// -------------------- Python Formatter --------------------
function formatPython(code) {
  return code.split('\n')
    .map(line => line.replace(/\s+$/g, ''))
    .join('\n');
}

// -------------------- File Handling --------------------
browseButton.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  document.getElementById('fileName').textContent = file.name;
  try {
    const content = await readFile(file);
    codeInput.value = content;
    autoDetectLanguage(file.name);
    formatCode();
    updateLivePreview(); // update live preview with uploaded code
  } catch (error) {
    showToast('Error reading file', true);
  }
});

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// -------------------- Core Formatting Logic --------------------
async function formatCode() {
  if (languageSelect.value === 'auto' && (!fileInput.files || fileInput.files.length === 0)) {
    alert("Please select a language.");
    return;
  }
  showLoading();
  try {
    const code = codeInput.value;
    const lang = detectLanguage();
    const formatted = await formatters[lang].format(code);
    formattedCode.textContent = formatted;
    formattedCode.className = `language-${formatters[lang].language}`;
    Prism.highlightElement(formattedCode);
  } catch (error) {
    formattedCode.textContent = `Error: ${error.message}`;
    showToast('Formatting failed', true);
  } finally {
    hideLoading();
  }
}

// -------------------- Language Detection --------------------
function detectLanguageFromContent(code) {
  const trimmedCode = code.trim();
  if (trimmedCode.startsWith('<!DOCTYPE html') || /<html/i.test(trimmedCode)) {
    return 'html';
  }
  if (/function\s+\w+\s*\(|\bvar\s+\w+|\blet\s+\w+|\bconst\s+\w+/.test(trimmedCode)) {
    return 'javascript';
  }
  if (/#include\s*<.*>/.test(trimmedCode) || /int\s+main\s*\(/.test(trimmedCode)) {
    return 'c';
  }
  if (/\bDECLARE\b/.test(trimmedCode) || /\bBEGIN\b[\s\S]*?\bEND\b/i.test(trimmedCode)) {
    return 'plsql';
  }
  if (/^\s*def\s+\w+\(/m.test(trimmedCode) || /^\s*import\s+\w+/m.test(trimmedCode)) {
    return 'python';
  }
  if (/{\s*[^}]*\s*}/.test(trimmedCode)) {
    return 'css';
  }
  return 'html';
}

function detectLanguage() {
  if (languageSelect.value === 'auto') {
    let detectedLang = '';
    const file = fileInput.files[0];
    if (file) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const langMap = { html: 'html', js: 'javascript', c: 'c', sql: 'plsql', plsql: 'plsql', py: 'python', css: 'css' };
      detectedLang = langMap[ext];
    }
    if (!detectedLang) {
      detectedLang = detectLanguageFromContent(codeInput.value);
    }
    return detectedLang;
  }
  return languageSelect.value;
}

function autoDetectLanguage(filename) {
  if (filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const langMap = { html: 'html', js: 'javascript', c: 'c', sql: 'plsql', plsql: 'plsql', py: 'python', css: 'css' };
    languageSelect.value = langMap[ext] || 'auto';
  } else {
    const detectedLang = detectLanguageFromContent(codeInput.value);
    languageSelect.value = detectedLang;
  }
}

// -------------------- Live Preview Mode --------------------
// Advanced live preview: supports HTML, CSS, JavaScript; shows a message for non-web languages.
async function updateLivePreview() {
  if (!livePreviewFrame) return;
  const lang = detectLanguage();
  let previewContent = "";
  if (lang === "html") {
    previewContent = codeInput.value;
  } else if (lang === "css") {
    previewContent = `<html><head><style>${codeInput.value}</style></head><body></body></html>`;
  } else if (lang === "javascript") {
    previewContent = `<html><head></head><body><script>${codeInput.value}<\/script></body></html>`;
  } else if (lang === "python") {
    previewContent = `<html><head></head><body><p>Live preview for Python is not available.</p></body></html>`;
  } else if (lang === "c" || lang === "plsql") {
    previewContent = `<html><head></head><body><p>Live preview is not available for ${lang} code.</p></body></html>`;
  } else {
    previewContent = codeInput.value;
  }
  const previewDoc = livePreviewFrame.contentDocument || livePreviewFrame.contentWindow.document;
  previewDoc.open();
  previewDoc.write(previewContent);
  previewDoc.close();
}

// -------------------- Debounce Function --------------------
function debounce(func, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => func(...args), delay);
  };
}

// -------------------- UI Helpers --------------------
function showLoading() {
  loading.classList.remove('loading-hidden');
}

function hideLoading() {
  loading.classList.add('loading-hidden');
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.className = isError ? 'toast-error' : 'toast-success';
  toast.style.visibility = 'visible';
  toast.style.opacity = '1';
  setTimeout(() => {
    toast.style.visibility = 'hidden';
    toast.style.opacity = '0';
  }, 2000);
}

// -------------------- Copy Button Handler --------------------
copyButton.addEventListener('click', () => {
  const textToCopy = formattedCode.textContent;
  const copyFallback = () => {
    const textArea = document.createElement('textarea');
    textArea.value = textToCopy;
    textArea.style.position = 'fixed';
    textArea.style.top = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      showToast('Copied!');
    } catch (err) {
      showToast('Copy failed!', true);
    } finally {
      document.body.removeChild(textArea);
    }
  };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(textToCopy)
      .then(() => showToast('Copied to clipboard!'))
      .catch(copyFallback);
  } else {
    copyFallback();
  }
});

// -------------------- Event Listeners --------------------
formatButton.addEventListener('click', formatCode);
codeInput.addEventListener('input', debounce(() => {
  if (languageSelect.value === 'auto') autoDetectLanguage('');
  updateLivePreview();
}, 300));
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    themeToggle.textContent = document.body.classList.contains('dark-mode') ? "☀ Light Mode" : "🌙 Dark Mode";
  });
}
