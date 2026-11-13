import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';

const _savedUrlKey = 'server_url';

bool _isPrivateHost(String host) {
  final normalized = host.toLowerCase();
  if (normalized == 'localhost' || normalized == '::1' || normalized == '127.0.0.1') return true;
  final parts = normalized.split('.');
  if (parts.length != 4) return false;
  final octets = parts.map(int.tryParse).toList();
  if (octets.any((value) => value == null || value < 0 || value > 255)) return false;
  final first = octets[0]!;
  final second = octets[1]!;
  return first == 10 ||
      (first == 192 && second == 168) ||
      (first == 172 && second >= 16 && second <= 31);
}

void main() {
  runApp(const SegrepassApp());
}

class SegrepassApp extends StatelessWidget {
  const SegrepassApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Segrepass Dashboard',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xFF126B63),
        brightness: Brightness.light,
      ),
      useMaterial3: true,
    ),
    home: const AppHome(),
  );
}

class AppHome extends StatefulWidget {
  const AppHome({super.key});

  @override
  State<AppHome> createState() => _AppHomeState();
}

class _AppHomeState extends State<AppHome> {
  final _urlController = TextEditingController();
  WebViewController? _webController;
  Uri? _serverUri;
  bool _loading = true;
  bool _hasError = false;
  bool _showSettings = false;

  @override
  void initState() {
    super.initState();
    _restoreUrl();
  }

  Future<void> _restoreUrl() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_savedUrlKey) ?? '';
    final url = _normalizeUrl(saved);
    if (saved.isNotEmpty && url == null) await prefs.remove(_savedUrlKey);
    if (!mounted) return;
    setState(() {
      _urlController.text = url ?? '';
      _showSettings = url == null;
    });
    if (url != null) _openUrl(url);
  }

  String? _normalizeUrl(String raw) {
    var value = raw.trim();
    if (value.isEmpty) return null;
    if (!value.contains('://')) value = 'https://$value';
    final uri = Uri.tryParse(value);
    if (uri == null || !uri.hasAuthority || uri.host.isEmpty) return null;
    final localHttpAllowed = kDebugMode && uri.scheme == 'http' && _isPrivateHost(uri.host);
    if (uri.scheme != 'https' && !localHttpAllowed) return null;
    return uri.toString().replaceFirst(RegExp(r'/+$'), '');
  }

  String? _normalizedUrl() => _normalizeUrl(_urlController.text);

  Future<void> _saveAndOpen() async {
    final url = _normalizedUrl();
    if (url == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Inserisci un indirizzo valido del server.'),
        ),
      );
      return;
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_savedUrlKey, url);
    _urlController.text = url;
    setState(() => _showSettings = false);
    _openUrl(url);
  }

  void _openUrl(String url) {
    final serverUri = Uri.tryParse(url);
    if (serverUri == null) return;
    _serverUri = serverUri;
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (request) {
            final target = Uri.tryParse(request.url);
            final base = _serverUri;
            final sameOrigin = target != null && base != null &&
                target.scheme == base.scheme &&
                target.host.toLowerCase() == base.host.toLowerCase() &&
                target.port == base.port;
            return sameOrigin ? NavigationDecision.navigate : NavigationDecision.prevent;
          },
          onPageStarted: (_) {
            if (!mounted) return;
            setState(() {
              _loading = true;
              _hasError = false;
            });
          },
          onPageFinished: (_) {
            if (mounted) setState(() => _loading = false);
          },
          onWebResourceError: (error) {
            if ((error.isForMainFrame ?? false) && mounted) {
              setState(() {
                _loading = false;
                _hasError = true;
              });
            }
          },
        ),
      )
      ..loadRequest(Uri.parse(url));
    setState(() {
      _webController = controller;
      _loading = true;
      _hasError = false;
    });
  }

  Future<void> _openSettings() async {
    setState(() => _showSettings = true);
  }

  Future<void> _back() async {
    if (_showSettings && _webController != null) {
      setState(() => _showSettings = false);
      return;
    }
    if (_webController != null && await _webController!.canGoBack()) {
      await _webController!.goBack();
    }
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _webController;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Segrepass'),
          actions: [
            if (controller != null && !_showSettings)
              IconButton(
                tooltip: 'Ricarica',
                icon: const Icon(Icons.refresh),
                onPressed: () => controller.reload(),
              ),
            IconButton(
              tooltip: 'Impostazioni server',
              icon: const Icon(Icons.settings_outlined),
              onPressed: _openSettings,
            ),
          ],
        ),
        body: _showSettings || controller == null
            ? _settingsView()
            : Stack(
                children: [
                  WebViewWidget(controller: controller),
                  if (_loading) const LinearProgressIndicator(minHeight: 2),
                  if (_hasError)
                    Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.wifi_off, size: 44),
                            const SizedBox(height: 12),
                            const Text(
                              'Server non raggiungibile. Controlla la connessione e l’indirizzo configurato.',
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: 12),
                            FilledButton.icon(
                              onPressed: () => controller.reload(),
                              icon: const Icon(Icons.refresh),
                              label: const Text('Riprova'),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
      ),
    );
  }

  Widget _settingsView() => ListView(
    padding: const EdgeInsets.all(24),
    children: [
      const Icon(Icons.school_outlined, size: 48),
      const SizedBox(height: 16),
      Text(
        'Collega il server',
        style: Theme.of(context).textTheme.headlineSmall,
      ),
      const SizedBox(height: 8),
      const Text(
        'Inserisci l’indirizzo del server Segrepass. L’app si riaprirà direttamente su questo indirizzo ai prossimi avvii.',
      ),
      const SizedBox(height: 20),
      TextField(
        controller: _urlController,
        keyboardType: TextInputType.url,
        autocorrect: false,
        decoration: const InputDecoration(
          labelText: 'Indirizzo del server',
          hintText: 'https://segrepass.example.it',
          border: OutlineInputBorder(),
          prefixIcon: Icon(Icons.link),
        ),
        onSubmitted: (_) => _saveAndOpen(),
      ),
      const SizedBox(height: 16),
      FilledButton.icon(
        onPressed: _saveAndOpen,
        icon: const Icon(Icons.open_in_browser),
        label: const Text('Salva e apri Segrepass'),
      ),
      const SizedBox(height: 20),
      const Text(
        'Per sicurezza sono accettati solo indirizzi HTTPS. In debug è consentito HTTP solo verso localhost o una rete privata; non usare questa modalità per distribuzioni pubbliche.',
        style: TextStyle(color: Colors.black54),
      ),
    ],
  );
}
