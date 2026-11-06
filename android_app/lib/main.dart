import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';

const _savedUrlKey = 'server_url';

void main() {
  runApp(const SegrepassApp());
}

class SegrepassApp extends StatelessWidget {
  const SegrepassApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Segrepass',
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
    final url = prefs.getString(_savedUrlKey) ?? '';
    if (!mounted) return;
    setState(() {
      _urlController.text = url;
      _showSettings = url.isEmpty;
    });
    if (url.isNotEmpty) _openUrl(url);
  }

  String? _normalizedUrl() {
    var value = _urlController.text.trim();
    if (value.isEmpty) return null;
    if (!value.contains('://')) value = 'https://$value';
    final uri = Uri.tryParse(value);
    if (uri == null || !uri.hasAuthority || uri.host.isEmpty) return null;
    if (uri.scheme != 'https' && uri.scheme != 'http') return null;
    return uri.toString().replaceFirst(RegExp(r'/+$'), '');
  }

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
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (_) => setState(() {
            _loading = true;
            _hasError = false;
          }),
          onPageFinished: (_) => setState(() => _loading = false),
          onWebResourceError: (error) {
            if (error.isForMainFrame ?? false) {
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
        'Per usare un indirizzo http della rete locale, telefono e computer devono essere sulla stessa Wi‑Fi e il server deve accettare connessioni dalla rete.',
        style: TextStyle(color: Colors.black54),
      ),
    ],
  );
}
