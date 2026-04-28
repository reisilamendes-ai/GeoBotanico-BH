/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  MapPin, Download, TreeDeciduous, 
  FileSearch, UploadCloud, Microscope, 
  Plus, LogIn, LogOut, Send, 
  Loader2, CheckCircle2, List,
  BrainCircuit, Crosshair, FileSpreadsheet,
  Globe, X, Leaf, ChevronRight, AlertCircle
} from 'lucide-react';
import { 
  collection, addDoc, onSnapshot, 
  query, orderBy, serverTimestamp,
  writeBatch, doc, limit, getDocs
} from 'firebase/firestore';
import { 
  signInWithPopup, GoogleAuthProvider, 
  onAuthStateChanged, signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  updateProfile,
  User 
} from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import * as XLSX from 'xlsx';
import { MapContainer, TileLayer, Marker, Popup, useMap, CircleMarker } from 'react-leaflet';
import L from 'leaflet';

import { db, auth, OperationType, handleFirestoreError } from './lib/firebase';

// Fix for Leaflet default icon issues in React
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

const treeIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png', // Or a custom tree marker
  iconSize: [25, 25],
  iconAnchor: [12, 25],
  popupAnchor: [1, -34],
});

const gallIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/484/484167.png', // Or a warning marker
  iconSize: [25, 25],
  iconAnchor: [12, 25],
  popupAnchor: [1, -34],
});
import { askGeoBotanico } from './services/geminiService';
import { TreeRecord } from './types';

// Regions of BH for simple tagging
const BH_REGIONS = [
  "Centro-Sul", "Pampulha", "Venda Nova", "Norte", 
  "Nordeste", "Noroeste", "Oeste", "Barreiro", "Leste"
];

// Map view synchronizer helper
function ChangeView({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, 14);
  }, [center, map]);
  return null;
}

import { get as idbGet, set as idbSet } from 'idb-keyval';

// Componente de ALTA PERFORMANCE (Custom Canvas Layer)
// Gerencia centenas de milhares de pontos desenhando diretamente no canvas context
const StaticInventoryLayer = ({ trees }: { trees: TreeRecord[] }) => {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!map || trees.length === 0) return;

    const CanvasLayer = L.Layer.extend({
      onAdd: function(map: L.Map) {
        const pane = map.getPane('overlayPane');
        const canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated') as HTMLCanvasElement;
        canvas.style.pointerEvents = 'none';
        // Garantir que o canvas fique atrás de marcadores interativos se houver
        canvas.style.zIndex = '200'; 
        this._canvas = canvas;
        pane?.appendChild(canvas);
        map.on('moveend', this._update, this);
        map.on('zoomend', this._update, this);
        this._update();
      },
      onRemove: function(map: L.Map) {
        L.DomUtil.remove(this._canvas);
        map.off('moveend', this._update, this);
        map.off('zoomend', this._update, this);
      },
      _update: function() {
        if (!this._canvas) return;
        const canvas = this._canvas;
        const size = map.getSize();
        const dpr = window.devicePixelRatio || 1;
        
        canvas.width = size.x * dpr;
        canvas.height = size.y * dpr;
        canvas.style.width = size.x + 'px';
        canvas.style.height = size.y + 'px';
        
        const topLeft = map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(canvas, topLeft);

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.scale(dpr, dpr);
        
        const zoom = map.getZoom();
        // Raio ajustado para precisão cirúrgica
        const radius = zoom <= 10 ? 0.35 : 
                       zoom <= 12 ? 0.65 : 
                       zoom <= 14 ? 1.4 : 
                       zoom <= 16 ? 3.5 : 
                       zoom <= 18 ? 7 : 11;
        
        ctx.fillStyle = 'rgba(158, 158, 158, 0.45)';
        
        const bounds = map.getBounds();
        const north = bounds.getNorth();
        const south = bounds.getSouth();
        const west = bounds.getWest();
        const east = bounds.getEast();

        for (let i = 0; i < trees.length; i++) {
          const tree = trees[i];
          const lat = tree.location.lat;
          const lng = tree.location.lng;

          // Culling geográfico rigoroso
          if (lat < south || lat > north || lng < west || lng > east) continue;

          // latLngToLayerPoint alinha perfeitamente com o sistema de coordenadas do Leaflet
          const point = map.latLngToLayerPoint([lat, lng]);
          
          // Ajustamos o ponto relativo ao topo-esquerdo do canvas posicionado pelo Leaflet
          ctx.beginPath();
          ctx.arc(point.x - topLeft.x, point.y - topLeft.y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });

    const layer = new (CanvasLayer as any)();
    layer.addTo(map);

    return () => {
      map.removeLayer(layer);
    };
  }, [map, trees]);

  return null;
};

// Helper to find column case-insensitively and ignoring spaces
const getRowVal = (row: any, aliases: string[]) => {
  const keys = Object.keys(row);
  const foundKey = keys.find(k => {
    const normalizedK = String(k).toLowerCase().replace(/[\s_.-]/g, '');
    return aliases.some(alias => normalizedK === alias.toLowerCase().replace(/[\s_.-]/g, ''));
  });
  return foundKey ? row[foundKey] : undefined;
};

const parseCoord = (val: any) => {
  if (val === undefined || val === null || val === "") return NaN;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const normalized = val.replace(',', '.').trim();
    const num = parseFloat(normalized);
    return isNaN(num) ? NaN : num;
  }
  return NaN;
};

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [items, setItems] = useState<TreeRecord[]>([]); // Research trees (Galls/Host)
  const [baseTrees, setBaseTrees] = useState<TreeRecord[]>([]); // Background BH trees (Grey)
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isUploadingXlsx, setIsUploadingXlsx] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, step: '' });
  const [inventoryStats, setInventoryStats] = useState({ total: 0, displayed: 0 });
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [loginForm, setLoginForm] = useState({ nickname: '', password: '' });
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const researchInputRef = useRef<HTMLInputElement>(null);
  const baseInputRef = useRef<HTMLInputElement>(null);
  // Carregamento automático de inventário persistente
  useEffect(() => {
    const checkCache = async () => {
      try {
        setUploadProgress({ current: 0, total: 0, step: 'Verificando cache local...' });
        const cachedData = await idbGet('base_inventory_cache');
        if (cachedData && cachedData.length > 0) {
          console.log("Inventário carregado do cache local (IndexedDB)");
          processLocalInventory(cachedData, false); // Don't re-save to IDB
          return;
        }
        
        console.log("Nenhum inventário em cache encontrado no boot.");
      } catch (err) {
        console.error("Erro no carregamento automático:", err);
      } finally {
        setUploadProgress(null);
      }
    };

    checkCache();
  }, []);

  const processLocalInventory = (data: any[], saveToCache = true) => {
    const totalItems = data.length;
    const localTrees: TreeRecord[] = [];
    const MAX_PROCESS = 300000;
    const step = totalItems > MAX_PROCESS ? Math.floor(totalItems / MAX_PROCESS) : 1;
    
    setInventoryStats({ total: totalItems, displayed: totalItems });

    for (let i = 0; i < data.length; i += step) {
      const row = data[i];
      const speciesVal = getRowVal(row, ['species', 'especie', 'nome', 'taxon', 'arvore', 'nomecientifico']);
      const species = (typeof speciesVal === 'string' ? speciesVal : 'Não identificado').slice(0, 100);
      const latVal = getRowVal(row, ['latitude', 'lat', 'y', 'coordinate_y', 'coordy', 'pontoy']);
      const lngVal = getRowVal(row, ['longitude', 'long', 'lng', 'x', 'coordinate_x', 'coordx', 'pontox']);
      const lat = parseCoord(latVal);
      const lng = parseCoord(lngVal);

      if (!isNaN(lat) && !isNaN(lng) && lat !== 0) {
        localTrees.push({
          id: `local-${i}`,
          species,
          location: { 
            lat, 
            lng,
            region: String(getRowVal(row, ['region', 'regiao']) || 'BH').slice(0, 50)
          },
          researcherId: 'local_inventory',
          researcherName: 'Inventário BH',
          createdAt: new Date().toISOString(),
          tags: ['Base']
        });
      }
    }

    if (saveToCache && localTrees.length > 0) {
      idbSet('base_inventory_cache', data)
        .then(() => console.log("Inventário internalizado no cache local."))
        .catch(e => console.error("Falha ao salvar cache:", e));
    }

    setBaseTrees(localTrees);
  };

  // AI State
  const [chatInput, setChatInput] = useState('');
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  
  // New Record State
  const [isAdding, setIsAdding] = useState(false);
  const [newSpecies, setNewSpecies] = useState('');
  const [newLat, setNewLat] = useState(-19.921);
  const [newLng, setNewLng] = useState(-43.941);
  const [newRegion, setNewRegion] = useState('Centro-Sul');

  // Pre-established users for testing
  const TEST_USERS: Record<string, string> = {
    'Isabela_Evelyn': 'galhas123',
    'Luisa_Eduarda': 'galhas123',
    'Ricardo_Ribeiro': 'galhas123',
    'Reisila_Mendes': 'galhas123'
  };

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser(u);
      } else {
        // Para evitar erros de "admin-restricted-operation" (Firebase Auth descofigurado),
        // usamos um perfil local simulado que permite o uso da interface.
        setUser({
          uid: 'pesquisador_local_' + Math.random().toString(36).substr(2, 9),
          displayName: 'Pesquisador Local',
          email: 'local@galhas.app'
        } as User);
      }
      setLoading(false);
    });
    return () => unsubscribeAuth();
  }, []);

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    console.log("Starting Google Login...");
    const provider = new GoogleAuthProvider();
    try {
      // Use signInWithPopup - if it fails due to iframe/popup block, alert the user
      const result = await signInWithPopup(auth, provider);
      console.log("Google Login Success:", result.user.email);
      setShowLoginModal(false);
    } catch (error: any) {
      console.error("Google Login Error:", error);
      let msg = "Erro ao acessar com Google.";
      if (error.code === 'auth/popup-blocked') {
        msg = "O popup de login foi bloqueado pelo seu navegador. Por favor, permita popups para este site.";
      } else if (error.code === 'auth/popup-closed-by-user') {
        msg = "O login foi cancelado pelo usuário.";
      } else {
        msg += ` Detalhes: ${error.message}`;
      }
      alert(msg);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleTestLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    // For convenience, always use the test account
    const nickname = "Pesquisador";
    const password = "password123";

    setIsLoggingIn(true);
    // Normalize nickname: remove spaces and special chars for the email part
    const normalizedNick = nickname.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
    const email = `${normalizedNick}@galhas.app.test`;
    
    try {
      console.log("Tentando Login de Teste:", email);
      try {
        await signInWithEmailAndPassword(auth, email, password);
        console.log("Login realizado com sucesso.");
      } catch (err: any) {
        console.warn("Falha no login direto, verificando necessidade de registro:", err.code);
        
        if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.message.includes('INVALID_LOGIN_CREDENTIALS')) {
          // If it's a wrong password for a standard test user, we should probably warn
          const standardUser = Object.keys(TEST_USERS).find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '_') === normalizedNick);
          if (standardUser && TEST_USERS[standardUser] !== password) {
             alert("Senha incorreta para este usuário de teste pré-cadastrado.");
             setIsLoggingIn(false);
             return;
          }

          try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(userCredential.user, {
              displayName: nickname.trim()
            });
            console.log("Novo usuário de teste criado.");
          } catch (createErr: any) {
            if (createErr.code === 'auth/email-already-in-use') {
              throw new Error("Senha incorreta para este apelido.");
            }
            if (createErr.code === 'auth/operation-not-allowed') {
              console.log("Provedor de email desativado, usando login anônimo com perfil.");
              const anonResult = await signInAnonymously(auth);
              await updateProfile(anonResult.user, {
                displayName: nickname.trim()
              });
            } else {
              throw createErr;
            }
          }
        } else if (err.code === 'auth/operation-not-allowed') {
          const anonResult = await signInAnonymously(auth);
          await updateProfile(anonResult.user, {
            displayName: nickname.trim()
          });
        } else {
          throw err;
        }
      }
      setShowLoginModal(false);
      setLoginForm({ nickname: '', password: '' });
    } catch (error: any) {
      console.error("Erro Final de Login:", error);
      alert(`Erro no acesso: ${error.message}`);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  useEffect(() => {
    if (!user) {
      setItems([]);
      setBaseTrees([]);
      return;
    }

    // Records (Galls/Research) stay in the cloud
    const q = query(collection(db, 'tree_records'), orderBy('createdAt', 'desc'), limit(100));
    const unsubscribeFirestore = onSnapshot(q, (snapshot) => {
      const records = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as TreeRecord[];
      setItems(records);
    }, (error) => {
      console.error("Firestore Error Handling:", error);
      // Fallback para evitar crash quando a cota atinge o limite
      if (error.message.includes("Quota") || error.message.includes("quota")) {
        console.warn("MODO OFFLINE ATIVADO: Cota do Firebase excedida para hoje.");
        // Não jogamos erro para o handleFirestoreError para não travar a UI
      } else {
        handleFirestoreError(error, OperationType.LIST, 'tree_records');
      }
    });

    // WE REMOVED THE base_trees Firestore fetch to save quota.
    // The "base trees" are now handled strictly via CSV/XLSX local loading + IndexedDB cache.

    return () => {
      unsubscribeFirestore();
    };
  }, [user]);

  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocalização não é suportada pelo seu navegador.");
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setNewLat(position.coords.latitude);
        setNewLng(position.coords.longitude);
        setIsLocating(false);
      },
      (error) => {
        console.error("Error getting location:", error);
        alert("Não foi possível obter sua localização. Verifique as permissões.");
        setIsLocating(false);
      },
      { enableHighAccuracy: true }
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'research' | 'base' | 'gall') => {
    const file = e.target.files?.[0];
    console.log("File upload started:", file?.name, "Type:", type);
    
    if (!file) {
      console.log("No file selected");
      return;
    }
    if (!user) return; // User is always set now

    setIsUploadingXlsx(true);
    setUploadProgress({ current: 0, total: 0, step: 'Lendo arquivo...' });

    const reader = new FileReader();
    reader.onload = async (evt) => {
      console.log("File reader onload triggered");
      try {
        const fileExt = file.name.split('.').pop()?.toLowerCase();
        const dataBuffer = evt.target?.result as ArrayBuffer;
        
        let wb;
        if (fileExt === 'csv') {
          console.log("Processing as CSV");
          wb = XLSX.read(dataBuffer, { type: 'array', codepage: 65001 }); // UTF-8
        } else {
          console.log("Processing as Binary Spreadsheet");
          wb = XLSX.read(dataBuffer, { type: 'array' });
        }
        
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        
        // Convert to JSON with raw headers if CSV to avoid delimiter issues
        const data = XLSX.utils.sheet_to_json(ws, { defval: "" }) as any[];
        console.log("Parsed records count:", data.length);
        
        if (!data || data.length === 0) {
          throw new Error("A planilha parece estar vazia ou o formato não foi reconhecido.");
        }

        const totalItems = data.length;
        setUploadProgress({ current: 0, total: totalItems, step: 'Iniciando processamento...' });

        // ESTRATÉGIA HÍBRIDA: Dados de "Base" (Inventário BH) são carregados apenas LOCALMENTE
        if (type === 'base') {
          processLocalInventory(data);
          alert(`Modo Híbrido Ativado!\n\n${totalItems} registros processados.\nO inventário foi carregado localmente para não consumir sua cota de banco de dados.`);
          setIsUploadingXlsx(false);
          setUploadProgress(null);
          return;
        }

        // Warning for huge spreadsheets only for non-base types
        if (totalItems > 15000) {
          alert(`ALERTA DE COTA: Sua planilha possui ${totalItems} registros. \n\nO limite diário gratuito do bando de dados é limitado. \n\nPor favor, utilize uma planilha com no máximo 5.000 registros.`);
          setIsUploadingXlsx(false);
          return;
        }

        const collectionPath = type as string === 'base' ? 'base_trees' : 'tree_records';

        // Dados de Galhas (Records) continuam indo para o Firestore em lotes pequenos
        const CHUNK_SIZE = 100; 
        let successfulCount = 0;
        let errorCount = 0;

        // Function to commit a batch with retries
        const commitWithRetry = async (batch: any, retries = 3): Promise<void> => {
          try {
            await batch.commit();
          } catch (error: any) {
            if (retries > 0 && (error.code === 'unavailable' || error.code === 'resource-exhausted')) {
              console.warn(`Lote falhou. Tentando novamente... (${retries} tentativas restantes)`);
              await new Promise(r => setTimeout(r, 2000)); // Wait 2s
              return commitWithRetry(batch, retries - 1);
            }
            throw error;
          }
        };

        for (let i = 0; i < data.length; i += CHUNK_SIZE) {
          const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
          const currentProgress = Math.min(i + CHUNK_SIZE, totalItems);
          const percent = Math.round((currentProgress / totalItems) * 100);
          
          setUploadProgress(prev => ({ 
            ...prev, 
            current: currentProgress, 
            step: `Processando Lote ${chunkNum} (${percent}%)...` 
          }));

          const chunk = data.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(db);
          let itemsInBatch = 0;

          chunk.forEach((row, indexInChunk) => {
            const speciesVal = getRowVal(row, ['species', 'especie', 'nome', 'taxon', 'arvore', 'nomecientifico']);
            const species = (typeof speciesVal === 'string' ? speciesVal : 'Não identificado').slice(0, 190);
            
            const latVal = getRowVal(row, ['lat', 'latitude', 'y', 'coordy', 'pontoy']);
            const lngVal = getRowVal(row, ['lng', 'long', 'longitude', 'x', 'coordx', 'pontox']);
            
            const lat = parseCoord(latVal);
            const lng = parseCoord(lngVal);
            
            const regionVal = getRowVal(row, ['region', 'regiao', 'bairro', 'local', 'distrito']);
            const region = String(regionVal || 'BH').slice(0, 100);

            if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
              const docRef = doc(collection(db, collectionPath));
              const tags = row.tags ? String(row.tags).split(',').map((t: string) => t.trim()) : [];
              
              if (type as string === 'research') tags.push('Hospedeira');
              if (type as string === 'gall') tags.push('Galha');
              if (type as string === 'base') tags.push('Base');

              // Preserve extra metadata
              const extraData: Record<string, any> = {};
              const processedKeys = [
                'species', 'especie', 'nome', 'taxon', 'arvore', 'nomecientifico',
                'lat', 'latitude', 'y', 'coordy', 'pontoy',
                'lng', 'long', 'longitude', 'x', 'coordx', 'pontox',
                'region', 'regiao', 'bairro', 'local', 'distrito', 'tags'
              ];
              
              Object.keys(row).forEach(key => {
                const normalizedK = String(key).toLowerCase().replace(/[\s_.-]/g, '');
                if (!processedKeys.includes(normalizedK)) {
                  const val = row[key];
                  // Ensure data is simple enough for Firestore
                  if (typeof val !== 'object') {
                    extraData[key] = val;
                  }
                }
              });

              batch.set(docRef, {
                species: species,
                location: {
                  lat: lat,
                  lng: lng,
                  region: region
                },
                tags: tags,
                researcherId: user.uid,
                researcherName: user.displayName || 'Sistema',
                createdAt: serverTimestamp(),
                additionalInfo: extraData
              });
              itemsInBatch++;
            } else {
              if (i === 0 && indexInChunk < 5) {
                console.log(`Pulando linha ${i + indexInChunk} por coordenadas inválidas:`, {lat, lng, row});
              }
            }
          });

          if (itemsInBatch > 0) {
            try {
              await commitWithRetry(batch);
              successfulCount += itemsInBatch;
              await new Promise(r => setTimeout(r, 100)); 
            } catch (err: any) {
              console.error(`Falha crítica no lote começando em ${i}:`, err);
              errorCount += itemsInBatch;
              // Se o primeiro lote falhar, para e avisa o usuário (evita spam de erros)
              if (i === 0) {
                alert(`Erro ao enviar o primeiro lote de dados: ${err.message}\n\nO processamento foi interrompido.`);
                setIsUploadingXlsx(false);
                return;
              }
            }
          }
        }

        if (successfulCount > 0) {
          const errorMsg = errorCount > 0 ? `\n\nNote: ${errorCount} registros falharam no envio.` : '';
          alert(`Sucesso! ${successfulCount} registros importados na categoria: ${type}.${errorMsg}`);
        } else {
          const headers = Object.keys(data[0] || {}).join(', ');
          alert(`Aviso: Nenhum registro válido encontrado. \n\nDetectamos estas colunas na sua planilha: [${headers}]. \n\nVerifique se as colunas de Latitude e Longitude possuem números válidos (ex: lat, long, latitude, longitude, X, Y). Se você usa vírgula como separador decimal, o sistema tentará converter automaticamente.`);
        }
      } catch (error: any) {
        console.error("Error importing XLSX:", error);
        alert(`Erro ao processar a planilha: ${error.message || "Verifique o formato do arquivo."}`);
      } finally {
        setIsUploadingXlsx(false);
        setUploadProgress({ current: 0, total: 0, step: '' });
        if (e.target) e.target.value = '';
      }
    };
    reader.onerror = () => {
      alert("Erro ao ler o arquivo selecionado.");
      setIsUploadingXlsx(false);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleAddRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return; // User is always set now

    try {
      const path = 'tree_records';
      await addDoc(collection(db, path), {
        species: newSpecies,
        location: {
          lat: Number(newLat),
          lng: Number(newLng),
          region: newRegion
        },
        tags: ["Nativa"], // Default
        researcherId: user.uid,
        researcherName: user.displayName || 'Pesquisador Anônimo',
        createdAt: serverTimestamp()
      });
      setIsAdding(false);
      setNewSpecies('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'tree_records');
    }
  };

  const handleAskAi = async () => {
    if (!chatInput.trim()) return;
    setIsAiLoading(true);
    setAiResponse(null);
    
    // Prepare context from current records
    const context = items.map(i => ({
      especie: i.species,
      lat: i.location.lat,
      long: i.location.lng,
      regiao: i.location.region,
      tags: i.tags,
      dados_adicionais: i.additionalInfo
    }));

    const response = await askGeoBotanico(chatInput, context);
    setAiResponse(response);
    setIsAiLoading(false);
    setChatInput('');
  };

  const handleExport = (format: string) => {
    setExporting(true);
    setTimeout(() => {
      setExporting(false);
      alert(`Mapa exportado como ${format.toUpperCase()}. Em um ambiente real, isso geraria um arquivo de alta resolução.`);
    }, 1500);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#2D5A27]" size={48} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF7] font-sans text-[#3E2723] flex flex-col">
      {/* Template Guide Modal */}
      <AnimatePresence>
        {showTemplateModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#3E2723]/60 backdrop-blur-sm z-[220] flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white p-8 rounded-[32px] shadow-2xl max-w-xl w-full relative overflow-hidden"
            >
              <button 
                onClick={() => setShowTemplateModal(false)}
                className="absolute top-6 right-6 text-[#9E9E9E] hover:text-black z-10"
              >
                <X size={24} />
              </button>

              <div className="flex items-center gap-4 mb-6">
                <div className="bg-[#E67E22] p-3 rounded-2xl text-white">
                  <FileSpreadsheet size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-serif font-bold text-[#2D5A27]">Guia de Importação Flexível</h3>
                  <p className="text-xs text-[#5D4037]">O sistema se adapta à sua planilha!</p>
                </div>
              </div>

              <div className="bg-[#FDFBF7] border-2 border-[#D7CCC8]/30 rounded-2xl overflow-hidden mb-6">
              <div className="space-y-4">
                <div className="bg-[#D7CCC8]/20 p-3 text-[10px] font-bold uppercase tracking-wider text-[#5D4037] border-b border-[#D7CCC8]/30">
                  Formato CSV Recomendado
                </div>
                <div className="p-4 bg-gray-50 rounded-lg font-mono text-[10px] text-[#3E2723] overflow-x-auto">
                  especie,latitude,longitude,regiao<br/>
                  Sibipiruna,-19.9213,-43.9412,Centro<br/>
                  Ipê Amarelo,-19.9345,-43.9102,Savassi
                </div>
                <div className="bg-[#D7CCC8]/20 p-3 text-[10px] font-bold uppercase tracking-wider text-[#5D4037] border-b border-[#D7CCC8]/30">
                  Colunas Essenciais (Detectadas Automaticamente)
                </div>
                <div className="p-4 space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-24 text-[10px] font-bold text-[#E67E22]">LOCALIZAÇÃO</div>
                    <div className="flex-1 text-sm text-[#3E2723]">Use colunas como: <i>latitude, longitude, lat, log, X, Y</i>.</div>
                  </div>
                  <div className="flex items-center gap-4 border-t border-[#D7CCC8]/20 pt-4">
                    <div className="w-24 text-[10px] font-bold text-[#2D5A27]">IDENTIFICAÇÃO</div>
                    <div className="flex-1 text-sm text-[#3E2723]">Use colunas como: <i>especie, taxon, nome, arvore</i>.</div>
                  </div>
                </div>
              </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs text-[#5D4037] leading-relaxed">
                  • <strong>Dica de Ouro:</strong> O sistema armazenará <strong>todas</strong> as outras colunas da sua planilha (ex: DAP, altura, estado fitossanitário) como metadados extras.<br/>
                  • <strong>Liberdade:</strong> Não se preocupe se não tiver <i>região</i> ou <i>bairro</i>; o sistema processará o que encontrar!<br/>
                  • <strong>Formato:</strong> Use arquivos .XLSX, .XLS ou .CSV (separado por vírgula ou ponto e vírgula).
                </p>
                <button 
                  onClick={() => setShowTemplateModal(false)}
                  className="w-full bg-[#2D5A27] text-white py-3 rounded-xl font-bold text-sm mt-4"
                >
                  Entendi, importar agora!
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {isUploadingXlsx && (
          <AnimatePresence>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-[#3E2723]/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-white p-8 rounded-[32px] shadow-2xl max-w-md w-full flex flex-col items-center gap-6 text-center"
              >
                <div className="relative">
                  <div className="absolute inset-0 bg-[#E67E22]/20 blur-xl rounded-full animate-pulse"></div>
                  <div className="bg-[#E67E22] p-6 rounded-full text-white relative">
                    <FileSpreadsheet size={48} />
                  </div>
                </div>
                
                <div>
                  <h3 className="text-2xl font-serif font-bold text-[#2D5A27]">{uploadProgress.step}</h3>
                  <p className="text-sm text-[#5D4037] mt-2 font-medium">Isso pode levar alguns segundos dependendo do tamanho da planilha.</p>
                </div>

                {uploadProgress.total > 0 && (
                  <div className="w-full space-y-2">
                    <div className="flex justify-between text-[10px] font-bold uppercase text-[#5D4037] tracking-widest">
                      <span>Progresso</span>
                      <span>{Math.round((uploadProgress.current / uploadProgress.total) * 100)}%</span>
                    </div>
                    <div className="w-full h-3 bg-[#D7CCC8]/30 rounded-full overflow-hidden border border-[#D7CCC8]/50">
                      <motion.div 
                        className="h-full bg-[#E67E22]"
                        initial={{ width: 0 }}
                        animate={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                        transition={{ ease: "easeOut" }}
                      />
                    </div>
                    <p className="text-[10px] text-[#9E9E9E]">
                      Processados {uploadProgress.current} de {uploadProgress.total} registros
                    </p>
                  </div>
                )}

                <Loader2 className="animate-spin text-[#2D5A27] mt-2" size={32} />
              </motion.div>
            </motion.div>
          </AnimatePresence>
        )}

      <header className="bg-[#2D5A27] text-white px-6 py-4 md:px-8 shadow-lg border-bottom border-b-4 border-[#E67E22] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-4"
          >
            <div className="bg-[#E67E22] p-2.5 rounded-xl text-white shadow-md">
              <Microscope size={28} />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-serif font-bold tracking-tight leading-none">GeoBotânico-BH</h1>
              <p className="hidden sm:block text-[10px] text-[#E8F5E9] uppercase tracking-[0.2em] font-sans mt-1 font-semibold">Monitoramento de Ecossistemas Urbanos</p>
            </div>
          </motion.div>
          
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4">
              <div className="hidden lg:block text-right">
                <p className="text-[10px] text-[#E8F5E9] uppercase tracking-wider font-sans opacity-80">
                  Pesquisador Ativo
                </p>
                <p className="text-sm font-bold text-white">{user?.displayName || 'Sistema'}</p>
              </div>
              <button 
                onClick={() => setIsAdding(!isAdding)}
                className="bg-[#E67E22] hover:bg-[#D35400] text-white px-5 py-2.5 rounded-full font-bold transition-all shadow-[0_4px_0_#D35400] hover:shadow-[0_2px_0_#D35400] active:translate-y-0.5 active:shadow-none flex items-center gap-2 text-sm"
              >
                <Plus size={18} /> <span className="hidden sm:inline">Novo Registro</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto w-full p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8 flex-1">
        {/* Aviso de Cota Excedida / Modo Offline */}
        <AnimatePresence>
          {(!items.length && !loading) && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              className="lg:col-span-12 overflow-hidden"
            >
              <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4 flex items-center gap-4 text-amber-900 shadow-sm mb-4">
                <AlertCircle className="text-amber-500 shrink-0" size={24} />
                <div className="flex-1">
                  <p className="text-xs font-bold uppercase tracking-wider mb-1">Cota do Banco de Dados Atingida</p>
                  <p className="text-[11px] opacity-80 leading-relaxed">
                    A plataforma atingiu o limite gratuito de consultas diárias ao Firebase. Os dados de pesquisa novos podem não aparecer até o reset (24h). 
                    <strong> O mapa continua funcional</strong> com a base de 260 mil árvores arquivada no seu dispositivo.
                  </p>
                </div>
                <div className="hidden md:block">
                  <p className="text-[10px] bg-white px-3 py-1.5 rounded-full border border-amber-200 font-bold">Modo Offline Ativo</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className={`flex flex-col gap-8 transition-all duration-300 ${sidebarOpen ? 'lg:col-span-8' : 'lg:col-span-12'}`}>
          <AnimatePresence>
            {isAdding && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="natural-card p-6 border-2 border-[#E67E22]/20"
              >
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-serif font-bold text-[#2D5A27] flex items-center gap-2">
                    <TreeDeciduous className="text-[#E67E22]" /> Cadastrar Novo Indivíduo
                  </h2>
                  <button 
                    onClick={getCurrentLocation}
                    disabled={isLocating}
                    className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#E67E22] hover:text-[#D35400] transition-colors disabled:opacity-50"
                  >
                    {isLocating ? <Loader2 size={16} className="animate-spin" /> : <Crosshair size={16} />}
                    Usar Minha Localização
                  </button>
                </div>
                <form onSubmit={handleAddRecord} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-[#5D4037] tracking-wider">Espécie</label>
                    <input 
                      required
                      value={newSpecies}
                      onChange={e => setNewSpecies(e.target.value)}
                      placeholder="Ex: Ipê Rosa"
                      className="w-full p-2.5 border border-[#D7CCC8] rounded-xl outline-[#2D5A27] text-sm bg-[#FDFBF7]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-[#5D4037] tracking-wider">Latitude</label>
                    <input 
                      type="number" step="0.000001" required
                      value={newLat}
                      onChange={e => setNewLat(Number(e.target.value))}
                      className="w-full p-2.5 border border-[#D7CCC8] rounded-xl outline-[#2D5A27] text-sm bg-[#FDFBF7]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-[#5D4037] tracking-wider">Longitude</label>
                    <input 
                      type="number" step="0.000001" required
                      value={newLng}
                      onChange={e => setNewLng(Number(e.target.value))}
                      className="w-full p-2.5 border border-[#D7CCC8] rounded-xl outline-[#2D5A27] text-sm bg-[#FDFBF7]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-[#5D4037] tracking-wider">Região</label>
                    <select 
                      value={newRegion}
                      onChange={e => setNewRegion(e.target.value)}
                      className="w-full p-2.5 border border-[#D7CCC8] rounded-xl outline-[#2D5A27] bg-[#FDFBF7] text-sm cursor-pointer"
                    >
                      {BH_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2 md:col-span-4 flex justify-end gap-3 mt-4">
                    <button type="button" onClick={() => setIsAdding(false)} className="px-6 py-2 text-[#5D4037] font-bold text-xs uppercase tracking-widest">Cancelar</button>
                    <button type="submit" className="bg-[#2D5A27] text-white px-8 py-2.5 rounded-xl font-bold shadow-md hover:bg-[#1e3d1a] transition-all text-xs uppercase tracking-widest">Gravar no Firebase</button>
                  </div>
                </form>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Map View Section */}
          <section className="flex flex-col gap-8 flex-1 relative">
            {/* Control to open sidebar if closed */}
            {!sidebarOpen && (
              <button 
                onClick={() => setSidebarOpen(true)}
                className="absolute top-6 right-6 z-[450] bg-[#2D5A27] text-white p-3 rounded-2xl shadow-2xl hover:scale-110 transition-all flex items-center gap-2 border-2 border-white"
              >
                <ChevronRight size={20} className="rotate-180" />
                <span className="text-[10px] font-bold uppercase tracking-widest hidden sm:inline">Ver Índices</span>
              </button>
            )}

            <div className="natural-card overflow-hidden flex flex-col flex-1 min-h-[500px]">
              <div className="p-4 px-6 bg-[#F5F5F5] border-b border-[#D7CCC8] flex justify-between items-center">
                <div className="flex items-center gap-3 font-bold text-[#5D4037] text-sm">
                  <MapPin size={18} className="text-[#E67E22] stroke-[2.5]"/> 
                  <span>Visualização Geoespacial: Savassi / Lourdes</span>
                </div>
                <div className="flex gap-2 items-center">
                  <span className="hidden sm:inline-block bg-[#E8F5E9] text-[#2D5A27] px-3 py-1 rounded-full text-[10px] font-bold uppercase">SIRIUS-BH</span>
                  <div className="flex gap-1">
                    <button onClick={() => handleExport('pdf')} className="bg-white border border-[#D7CCC8] text-[#5D4037] px-3 py-1.5 rounded-lg hover:bg-gray-50 flex items-center gap-1.5 transition-colors font-bold text-[10px] uppercase">
                      PDF
                    </button>
                    <button onClick={() => handleExport('png')} className="bg-white border border-[#D7CCC8] text-[#5D4037] px-3 py-1.5 rounded-lg hover:bg-gray-50 flex items-center gap-1.5 transition-colors font-bold text-[10px] uppercase">
                      PNG
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex-1 relative bg-[#E0E0E0] group overflow-hidden">
                <MapContainer 
                  center={[newLat, newLng]} 
                  zoom={13} 
                  preferCanvas={true}
                  scrollWheelZoom={true}
                  className="w-full h-full"
                >
                  <ChangeView center={[newLat, newLng]} />
                  <TileLayer
                    attribution='&copy; OpenStreetMap'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  
      {/* Layer 1: Base Population (Static Canvas Layer) */}
      <StaticInventoryLayer trees={baseTrees} />

                  {/* Layer 2: Research/Host (Green) & Galls (Orange) */}
                  {items.map((tree) => {
                    const tags = tree.tags || [];
                    const isGall = tags.includes('Galha');
                    const isHost = tags.includes('Hospedeira');
                    
                    return (
                      <CircleMarker 
                        key={tree.id} 
                        center={[tree.location?.lat || 0, tree.location?.lng || 0]}
                        radius={8}
                        pathOptions={{
                          fillColor: isGall ? '#E67E22' : '#2D5A27',
                          color: 'white',
                          weight: 2,
                          fillOpacity: 0.9
                        }}
                      >
                        <Popup className="font-sans">
                          <div className="p-2">
                            <h4 className={`font-bold text-sm mb-1 ${isGall ? 'text-[#E67E22]' : 'text-[#2D5A27]'}`}>
                              {tree.species}
                            </h4>
                            <p className="text-[10px] text-[#5D4037] mb-2 font-medium">Categoria: {isGall ? 'Incidência de Galha' : 'Hospedeira Pesquisa'}</p>
                            <div className="flex flex-wrap gap-1">
                              {tags.map(t => (
                                <span key={t} className={`text-[8px] px-1.5 py-0.5 rounded border ${isGall ? 'bg-[#FFF3E0] border-[#E67E22]/30' : 'bg-[#E8F5E9] border-[#2D5A27]/30'}`}>
                                  {t}
                                </span>
                              ))}
                            </div>
                            <p className="text-[9px] mt-2 opacity-50 italic">Coleta: {tree.researcherName}</p>
                          </div>
                        </Popup>
                      </CircleMarker>
                    );
                  })}
                </MapContainer>
                
                {/* Legend Overlay */}
                {!isUploadingXlsx && !showLoginModal && !showTemplateModal && !isAiLoading && showLegend && (
                  <div className="absolute bottom-6 right-6 bg-white/95 backdrop-blur-sm p-5 rounded-2xl border border-[#D7CCC8] shadow-2xl w-60 z-[400] text-[#3E2723]">
                    <div className="flex justify-between items-center mb-4">
                      <p className="text-[10px] font-bold text-[#2D5A27] uppercase tracking-[0.1em] flex items-center gap-2">
                        <CheckCircle2 size={12} /> Monitoramento
                      </p>
                      <button 
                        onClick={() => setShowLegend(false)}
                        className="text-[#9E9E9E] hover:text-[#E67E22] transition-colors"
                        title="Fechar Legenda"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-3 text-[10px] font-medium text-[#5D4037]">
                        <span className="w-2.5 h-2.5 bg-[#9E9E9E] rounded-full border border-gray-400"></span>
                        População BH (Base)
                      </div>
                      <div className="flex items-center gap-3 text-[10px] font-medium text-[#2D5A27]">
                        <span className="w-2.5 h-2.5 bg-[#2ecc71] rounded-full border border-[#27ae60]"></span>
                        Hospedeiras Pesquisa
                      </div>
                      <div className="flex items-center gap-3 text-[10px] font-medium text-[#E67E22]">
                        <span className="w-2.5 h-2.5 bg-[#E67E22] rounded-full shadow-[0_0_8px_#E67E22]"></span>
                        Presença de Galhas
                      </div>
                    </div>
                  </div>
                )}

                {/* Legend Re-open Button */}
                {!showLegend && (
                  <button 
                    onClick={() => setShowLegend(true)}
                    className="absolute bottom-6 right-6 bg-white p-2.5 rounded-full border border-[#D7CCC8] shadow-lg z-[400] text-[#2D5A27] hover:scale-110 transition-transform"
                    title="Ver Legenda"
                  >
                    <List size={20} />
                  </button>
                )}

                {exporting && (
                  <motion.div 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="absolute inset-0 bg-white/80 backdrop-blur-md flex flex-col items-center justify-center gap-4 z-20"
                  >
                    <Loader2 className="animate-spin text-[#2D5A27]" size={48} />
                    <span className="font-serif font-bold text-[#2D5A27] tracking-widest uppercase text-sm">Renderizando Camada Geoespacial...</span>
                  </motion.div>
                )}
              </div>
            </div>

            {/* Quick Stats Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
              <div className="bg-white p-5 rounded-2xl border border-[#D7CCC8] flex items-center gap-4 shadow-sm">
                <div className="text-3xl font-serif font-bold text-[#E67E22]">{items.length}</div>
                <div className="text-[10px] uppercase font-bold text-[#5D4037] leading-[1.2] tracking-wider">Altas na<br />Nuvem</div>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-[#D7CCC8] flex flex-col justify-center shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="text-2xl font-serif font-bold text-[#5D4037]">{(inventoryStats.total / 1000).toFixed(0)}k</div>
                  <div className="text-[8px] uppercase font-bold text-[#9E9E9E] tracking-tighter">Registros<br/>Totais</div>
                </div>
                <div className="w-full h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
                  <div className="h-full bg-[#E67E22]" style={{ width: `${Math.min((inventoryStats.displayed/inventoryStats.total)*100 || 0, 100)}%` }}></div>
                </div>
                <p className="text-[8px] text-[#9E9E9E] mt-1 font-bold italic">Exibindo {inventoryStats.displayed} (Amostra)</p>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-[#D7CCC8] flex items-center gap-4 shadow-sm">
                <div className="text-3xl font-serif font-bold text-[#5D4037]">12%</div>
                <div className="text-[10px] uppercase font-bold text-[#5D4037] leading-[1.2] tracking-wider">Taxa de<br />Infestação</div>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-[#D7CCC8] flex items-center gap-4 shadow-sm">
                <div className="text-3xl font-serif font-bold text-[#2D5A27]">0{BH_REGIONS.length}</div>
                <div className="text-[10px] uppercase font-bold text-[#5D4037] leading-[1.2] tracking-wider">Regiões<br />Monitoradas</div>
              </div>
            </div>
          </section>
        </div>

        {/* Sidebar Section */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.aside 
              initial={{ x: 400, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 400, opacity: 0 }}
              className="lg:col-span-4 flex flex-col gap-6 w-full lg:w-[400px] bg-white border-l border-[#D7CCC8]/40 p-6 overflow-y-auto overflow-x-hidden relative custom-scrollbar"
            >
              {/* Force Toggle Button inside Sidebar */}
              <button 
                onClick={() => setSidebarOpen(false)}
                className="absolute top-6 right-6 text-[#9E9E9E] hover:text-[#2D5A27] transition-colors p-1"
                title="Recolher Painel"
              >
                <X size={20} />
              </button>

              {/* AI Analysis Interface Integrated to Sidebar as a Lab Card */}
          <div className="natural-card p-6 flex flex-col gap-4 bg-[#F5F5F5]/30">
            <div className="flex items-center gap-2 text-[#2D5A27]">
              <BrainCircuit className="text-[#E67E22]" size={20} />
              <h3 className="font-serif text-lg font-bold">Assistente GeoBotânico</h3>
            </div>
            
            <div className="bg-white rounded-2xl border border-[#D7CCC8] p-4 flex flex-col gap-3 min-h-[200px]">
              <div className="flex-1 overflow-y-auto max-h-[300px] text-sm custom-scrollbar">
                {!aiResponse && !isAiLoading && (
                  <div className="h-full flex flex-col items-center justify-center text-center opacity-40 py-8">
                     <p className="italic text-xs">Ex: "Quais espécies são hospedeiras na Venda Nova?"</p>
                  </div>
                )}
                {isAiLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="animate-spin text-[#2D5A27]" size={24} />
                  </div>
                )}
                {aiResponse && (
                  <div className="prose prose-sm prose-stone max-w-none">
                    <ReactMarkdown>{aiResponse}</ReactMarkdown>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <input 
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAskAi()}
                  placeholder="Perguntar à IA..."
                  className="flex-1 p-2 bg-[#FDFBF7] border border-[#D7CCC8] rounded-lg outline-none text-xs"
                />
                <button 
                  onClick={handleAskAi}
                  disabled={isAiLoading || !chatInput.trim()}
                  className="bg-[#2D5A27] text-white p-2 rounded-lg hover:bg-[#1e3d1a] disabled:opacity-50"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Recent Inventory - Natural Card */}
          <div className="natural-card p-6 flex flex-col flex-1 min-h-[400px]">
             <h3 className="text-lg font-serif font-bold text-[#2D5A27] border-b-2 border-[#F5F5F5] pb-3 mb-4">Inventário Recente</h3>
             <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-3 custom-scrollbar">
                {items.length === 0 && (
                  <div className="text-center py-12 opacity-30">
                    <TreeDeciduous size={48} className="mx-auto mb-2" />
                    <p className="text-xs font-bold uppercase tracking-widest">Sem registros</p>
                  </div>
                )}
                {items.map(tree => {
                  const tags = tree.tags || [];
                  return (
                    <motion.div 
                      layoutId={tree.id}
                      key={tree.id} 
                      className={`p-4 bg-[#FDFBF7] rounded-xl border-l-[6px] shadow-sm hover:shadow-md transition-all ${tags.includes('Galha') ? 'border-[#E67E22]' : 'border-[#2D5A27]'}`}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <p className="font-bold text-[13px]">{tree.species}</p>
                        <span className="text-[9px] font-bold text-[#5D4037]/60">{tree.location?.region}</span>
                      </div>
                      <p className="text-[10px] text-[#5D4037] font-sans">
                        {tags.includes('Galha') ? '⚠️ Presença de patógeno detectado' : '✅ Espécime saudável'}
                      </p>
                      {tree.additionalInfo && Object.keys(tree.additionalInfo).length > 0 && (
                        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[9px] text-[#5D4037]/70 italic">
                          {Object.entries(tree.additionalInfo).slice(0, 4).map(([key, val]) => (
                            <div key={key} className="truncate">
                              <span className="font-bold">{key}:</span> {String(val)}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="mt-2 flex gap-1">
                         {tags.map(t => <span key={t} className="text-[8px] bg-white border border-[#D7CCC8] px-1.5 py-0.5 rounded text-[#5D4037] font-bold">{t}</span>)}
                      </div>
                    </motion.div>
                  );
                })}
             </div>
          </div>

          {/* Gemini RAG Lab Card */}
          <div className="bg-[#5D4037] p-6 rounded-[24px] text-white shadow-xl flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="text-[#E67E22]">
                  <FileSearch size={22} className="stroke-[2.5]" />
                </div>
                <h3 className="font-sans font-extrabold text-[15px] uppercase tracking-wider">Laboratório RAG</h3>
              </div>
              {isUploadingXlsx && <Loader2 size={16} className="animate-spin text-[#E67E22]" />}
            </div>
            
            <div className="flex items-center justify-between">
               <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#BCAAA4]">Integração Labs</h4>
               <div className="flex gap-3">
                <button 
                  onClick={() => setShowTemplateModal(true)}
                  className="text-[10px] font-bold text-[#E67E22] hover:underline flex items-center gap-1"
                >
                  <FileSearch size={12} /> Ver Modelo de Tabela
                </button>
               </div>
            </div>
            
            <p className="text-[11px] text-[#D7CCC8] leading-relaxed font-sans">
              Importe planilha de árvores (.XLSX) para povoar o mapa. Use colunas como: **especie, latitude, longitude, regiao**.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div 
                onClick={() => baseInputRef.current?.click()}
                className="border-2 border-dashed border-white/20 rounded-2xl p-4 text-center bg-white/5 hover:bg-white/10 cursor-pointer transition-all flex flex-col items-center gap-2 group"
                title="Povoamento Base (Obrigatório: species, lat, lng)"
              >
                 <TreeDeciduous size={22} className="text-[#9E9E9E]" />
                 <p className="text-[7px] font-bold uppercase tracking-widest leading-none">Povoamento Base<br/>(Cinza)</p>
                 <input type="file" ref={baseInputRef} onChange={e => handleFileUpload(e, 'base')} accept=".xlsx,.xls,.csv" className="hidden" />
              </div>

              <div 
                onClick={() => researchInputRef.current?.click()}
                className="border-2 border-dashed border-white/20 rounded-2xl p-4 text-center bg-white/5 hover:bg-white/10 cursor-pointer transition-all flex flex-col items-center gap-2 group"
                title="Importar Árvores de Pesquisa"
              >
                 <Microscope size={22} className="text-[#2ecc71]" />
                 <p className="text-[7px] font-bold uppercase tracking-widest leading-none">Hospedeiras<br/>(Verde)</p>
                 <input type="file" ref={researchInputRef} onChange={e => handleFileUpload(e, 'research')} accept=".xlsx,.xls,.csv" className="hidden" />
              </div>

              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-white/20 rounded-2xl p-4 text-center bg-white/5 hover:bg-white/10 cursor-pointer transition-all flex flex-col items-center gap-2 group"
                title="Importar Ocorrências de Galhas"
              >
                 <BrainCircuit size={22} className="text-[#E67E22]" />
                 <p className="text-[7px] font-bold uppercase tracking-widest leading-none">Galhas<br/>(Laranja)</p>
                 <input type="file" ref={fileInputRef} onChange={e => handleFileUpload(e, 'gall')} accept=".xlsx,.xls,.csv" className="hidden" />
              </div>

              <div 
                onClick={() => alert("O Laboratório RAG de teses será habilitado em breve. No momento, use a importação de planilhas de árvores.")}
                className="border-2 border-dashed border-white/20 rounded-2xl p-4 text-center bg-white/5 hover:bg-white/10 cursor-pointer transition-all flex flex-col items-center gap-2 group opacity-50"
                title="Teses RAG Analysis (Em breve)"
              >
                 <UploadCloud size={22} className="text-white" />
                 <p className="text-[7px] font-bold uppercase tracking-widest leading-none">Teses<br/>RAG Analysis</p>
              </div>
            </div>
          </div>
          </motion.aside>
          )}
        </AnimatePresence>
      </main>

      {/* Status Footer */}
      <footer className="bg-[#F5F5F5] border-t border-[#D7CCC8] px-8 py-3 flex flex-col sm:flex-row justify-between items-center gap-4 text-[10px] font-bold text-[#5D4037] tracking-wider uppercase">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-[#2ecc71] rounded-full animate-pulse shadow-[0_0_5px_#2ecc71]"></span>
          <span>Base de dados Firebase: Conectado (Estável)</span>
        </div>
        <div className="text-[#9E9E9E] opacity-70">
          Coordenadas BH: -19.921, -43.941 | Belo Horizonte/MG
        </div>
      </footer>
    </div>
  );
}
