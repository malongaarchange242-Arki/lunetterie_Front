
import React, { useState, useEffect } from 'react';

const IMAGES = [
  'https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=150&h=150&fit=crop',
  'https://images.unsplash.com/photo-1523821741446-edb429f67505?w=150&h=150&fit=crop',
  'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=150&h=150&fit=crop',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop',
  'https://images.unsplash.com/photo-1519167758481-83f19dd76716?w=150&h=150&fit=crop',
];

const DEMO_PROFORMATS = [
  { id: 'PRF001', ref: 'MN-AVA-001', clientName: 'Jean Dupont', phone: '06 12 34 56 78', vendeurName: 'Sarah', montureType: 'Monture Aviateur Doré', verresType: 'Verres Correcteurs', image: IMAGES[0], price: 73000, destination: 'labo', createdAt: new Date().toISOString(), status: 'en_attente', paymentMethod: null },
  { id: 'PRF002', ref: 'MN-CHT-002', clientName: 'Sophie Martin', phone: '07 45 67 89 12', vendeurName: 'Marie', montureType: 'Monture Chat Rose', verresType: 'Verres Solaires Polarisés', image: IMAGES[1], price: 93000, destination: 'reserve', createdAt: new Date().toISOString(), status: 'en_attente', paymentMethod: null },
  { id: 'PRF003', ref: 'MN-ECL-004', clientName: 'Marc Fontaine', phone: '07 44 55 66 77', vendeurName: 'Sarah', montureType: 'Monture Écaille', verresType: 'Verres Anti-Lumière Bleue', image: IMAGES[2], price: 87000, destination: 'labo', createdAt: new Date().toISOString(), status: 'en_attente', paymentMethod: null },
  { id: 'PRF004', ref: 'MN-SPT-003', clientName: 'Nathalie Girard', phone: '06 77 88 99 00', vendeurName: 'Julie', montureType: 'Monture Sport Titane', verresType: 'Verres Progressifs', image: IMAGES[3], price: 137000, destination: 'labo', createdAt: new Date().toISOString(), status: 'validée', paymentMethod: 'Cash' },
  { id: 'PRF005', ref: 'MN-AVA-002', clientName: 'Pierre Roussel', phone: '07 34 56 78 90', vendeurName: 'Marie', montureType: 'Monture Aviateur Noir', verresType: 'Verres Correcteurs', image: IMAGES[4], price: 73000, destination: 'reserve', createdAt: new Date().toISOString(), status: 'validée', paymentMethod: null },
  { id: 'PRF006', ref: 'MN-CHT-003', clientName: 'Amélie Bernard', phone: '06 23 45 67 89', vendeurName: 'Julie', montureType: 'Monture Chat Noir', verresType: 'Verres Solaires', image: IMAGES[1], price: 85000, destination: 'labo', createdAt: new Date(Date.now() - 3600000).toISOString(), status: 'validée', paymentMethod: 'Mutuelle' },
  { id: 'PRF007', ref: 'MN-RND-001', clientName: 'Luc Pelletier', phone: '07 56 78 90 12', vendeurName: 'Sarah', montureType: 'Monture Ronde Vintage', verresType: 'Verres Correcteurs', image: IMAGES[0], price: 95000, destination: 'labo', createdAt: new Date(Date.now() - 7200000).toISOString(), status: 'validée', paymentMethod: 'Chèque' },
  { id: 'PRF008', ref: 'MN-CAT-002', clientName: 'Isabelle Moreau', phone: '06 34 56 78 90', vendeurName: 'Marie', montureType: 'Monture Cats Eye', verresType: 'Verres Anti-Reflet', image: IMAGES[2], price: 78000, destination: 'reserve', createdAt: new Date(Date.now() - 1800000).toISOString(), status: 'validée', paymentMethod: null },
  { id: 'PRF009', ref: 'MN-SPT-004', clientName: 'Thomas Durand', phone: '07 67 89 01 23', vendeurName: 'Sarah', montureType: 'Monture Sport Bleu', verresType: 'Verres Polarisés', image: IMAGES[3], price: 125000, destination: 'labo', createdAt: new Date().toISOString(), status: 'en_attente', paymentMethod: null },
  { id: 'PRF010', ref: 'MN-WAY-001', clientName: 'Carole Petit', phone: '06 45 67 89 01', vendeurName: 'Julie', montureType: 'Monture Wayfarer', verresType: 'Verres Correcteurs', image: IMAGES[4], price: 82000, destination: 'labo', createdAt: new Date().toISOString(), status: 'en_attente', paymentMethod: null },
  
  { id: 'PRF011', ref: 'MN-AVA-003', clientName: 'David Laurent', phone: '07 78 90 12 34', vendeurName: 'Marie', montureType: 'Monture Aviateur Argent', verresType: 'Verres Solaires', image: IMAGES[0], price: 76000, destination: 'reserve', createdAt: new Date(Date.now() - 5400000).toISOString(), status: 'validée', paymentMethod: null },
  { id: 'PRF012', ref: 'MN-ECL-005', clientName: 'Francine Gaston', phone: '06 56 78 90 12', vendeurName: 'Sarah', montureType: 'Monture Écaille Marron', verresType: 'Verres Progressifs', image: IMAGES[2], price: 98000, destination: 'labo', createdAt: new Date().toISOString(), status: 'validée', paymentMethod: 'Mobile Money' },
  { id: 'PRF013', ref: 'MN-RND-002', clientName: 'Guy Lefevre', phone: '07 89 01 23 45', vendeurName: 'Julie', montureType: 'Monture Ronde Dorée', verresType: 'Verres Correcteurs', image: IMAGES[1], price: 88000, destination: 'labo', createdAt: new Date().toISOString(), status: 'en_attente', paymentMethod: null },
  { id: 'PRF014', ref: 'MN-CHT-004', clientName: 'Michèle Rousseau', phone: '06 67 89 01 23', vendeurName: 'Marie', montureType: 'Monture Chat Violet', verresType: 'Verres Anti-Lumière Bleue', image: IMAGES[3], price: 92000, destination: 'reserve', createdAt: new Date(Date.now() - 2700000).toISOString(), status: 'validée', paymentMethod: null },
  { id: 'PRF015', ref: 'MN-SPT-005', clientName: 'Nicolas Blanc', phone: '07 90 12 34 56', vendeurName: 'Sarah', montureType: 'Monture Sport Rouge', verresType: 'Verres Polarisés', image: IMAGES[4], price: 132000, destination: 'labo', createdAt: new Date().toISOString(), status: 'en_attente', paymentMethod: null },

  { id: 'PRF016', ref: 'MN-WAY-002', clientName: 'Patricia Gérard', phone: '06 78 90 12 34', vendeurName: 'Julie', montureType: 'Monture Wayfarer Noir', verresType: 'Verres Solaires Polarisés', image: IMAGES[0], price: 81000, destination: 'labo', createdAt: new Date(Date.now() - 4500000).toISOString(), status: 'validée', paymentMethod: 'Cash' },
  { id: 'PRF017', ref: 'MN-AVA-004', clientName: 'Régis Leblanc', phone: '07 01 23 45 67', vendeurName: 'Marie', montureType: 'Monture Aviateur Rose', verresType: 'Verres Correcteurs', image: IMAGES[1], price: 75000, destination: 'reserve', createdAt: new Date().toISOString(), status: 'en_attente', paymentMethod: null },
  { id: 'PRF018', ref: 'MN-ECL-006', clientName: 'Yvette Mercier', phone: '06 89 01 23 45', vendeurName: 'Sarah', montureType: 'Monture Écaille Clair', verresType: 'Verres Anti-Reflet', image: IMAGES[2], price: 86000, destination: 'labo', createdAt: new Date(Date.now() - 6300000).toISOString(), status: 'validée', paymentMethod: 'Chèque' },
  { id: 'PRF019', ref: 'MN-CAT-003', clientName: 'Sylvain Roux', phone: '07 12 34 56 78', vendeurName: 'Julie', montureType: 'Monture Cats Eye Doré', verresType: 'Verres Progressifs', image: IMAGES[3], price: 100000, destination: 'reserve', createdAt: new Date(Date.now() - 900000).toISOString(), status: 'validée', paymentMethod: null },
  { id: 'PRF020', ref: 'MN-RND-003', clientName: 'Corinne Gillet', phone: '06 90 12 34 56', vendeurName: 'Sarah', montureType: 'Monture Ronde Bleu', verresType: 'Verres Solaires', image: IMAGES[4], price: 79000, destination: 'labo', createdAt: new Date().toISOString(), status: 'en_attente', paymentMethod: null },

  { id: 'PRF021', ref: 'MN-SPT-006', clientName: 'Hervé Leroy', phone: '07 23 45 67 89', vendeurName: 'Marie', montureType: 'Monture Sport Vert', verresType: 'Verres Correcteurs', image: IMAGES[0], price: 128000, destination: 'labo', createdAt: new Date(Date.now() - 10800000).toISOString(), status: 'validée', paymentMethod: 'Mutuelle' },
  { id: 'PRF022', ref: 'MN-CHT-005', clientName: 'Denise Barbier', phone: '06 01 23 45 67', vendeurName: 'Julie', montureType: 'Monture Chat Orange', verresType: 'Verres Anti-Lumière Bleue', image: IMAGES[1], price: 91000, destination: 'reserve', createdAt: new Date().toISOString(), status: 'en_attente', paymentMethod: null },
  { id: 'PRF023', ref: 'MN-WAY-003', clientName: 'Yves Collard', phone: '07 34 56 78 90', vendeurName: 'Sarah', montureType: 'Monture Wayfarer Marron', verresType: 'Verres Solaires Polarisés', image: IMAGES[2], price: 83000, destination: 'labo', createdAt: new Date(Date.now() - 8100000).toISOString(), status: 'validée', paymentMethod: 'Mobile Money' },
  { id: 'PRF024', ref: 'MN-AVA-005', clientName: 'Bernadette Caron', phone: '06 12 34 56 78', vendeurName: 'Marie', montureType: 'Monture Aviateur Bronzé', verresType: 'Verres Correcteurs', image: IMAGES[3], price: 72000, destination: 'labo', createdAt: new Date().toISOString(), status: 'en_attente', paymentMethod: null },
  { id: 'PRF025', ref: 'MN-RND-004', clientName: 'Jérôme Perrin', phone: '07 45 67 89 01', vendeurName: 'Julie', montureType: 'Monture Ronde Noire', verresType: 'Verres Progressifs', image: IMAGES[4], price: 89000, destination: 'reserve', createdAt: new Date(Date.now() - 3600000).toISOString(), status: 'validée', paymentMethod: null },

  { id: 'PRF026', ref: 'MN-ECL-007', clientName: 'Anita Legrand', phone: '06 23 45 67 89', vendeurName: 'Sarah', montureType: 'Monture Écaille Gris', verresType: 'Verres Anti-Reflet', image: IMAGES[0], price: 84000, destination: 'labo', createdAt: new Date(Date.now() - 5400000).toISOString(), status: 'validée', paymentMethod: 'Cash' },
  { id: 'PRF027', ref: 'MN-CAT-004', clientName: 'Thierry Giraud', phone: '07 56 78 90 12', vendeurName: 'Marie', montureType: 'Monture Cats Eye Rose', verresType: 'Verres Solaires', image: IMAGES[1], price: 80000, destination: 'labo', createdAt: new Date().toISOString(), status: 'en_attente', paymentMethod: null },
  { id: 'PRF028', ref: 'MN-SPT-007', clientName: 'Viviane Chevalier', phone: '06 34 56 78 90', vendeurName: 'Julie', montureType: 'Monture Sport Jaune', verresType: 'Verres Correcteurs', image: IMAGES[2], price: 130000, destination: 'reserve', createdAt: new Date(Date.now() - 2700000).toISOString(), status: 'validée', paymentMethod: null },
  { id: 'PRF029', ref: 'MN-WAY-004', clientName: 'Raymond Simon', phone: '07 67 89 01 23', vendeurName: 'Sarah', montureType: 'Monture Wayfarer Bleu', verresType: 'Verres Polarisés', image: IMAGES[3], price: 84000, destination: 'labo', createdAt: new Date(Date.now() - 7200000).toISOString(), status: 'validée', paymentMethod: 'Chèque' },
  { id: 'PRF030', ref: 'MN-AVA-006', clientName: 'Lucette Fournier', phone: '06 45 67 89 01', vendeurName: 'Marie', montureType: 'Monture Aviateur Vert', verresType: 'Verres Anti-Lumière Bleue', image: IMAGES[4], price: 74000, destination: 'labo', createdAt: new Date().toISOString(), status: 'en_attente', paymentMethod: null },
];

export default function LunetterieCaisseMagasin() {
  const [proformats, setProformats] = useState(DEMO_PROFORMATS);
  const [tab, setTab] = useState('attente');
  const [selectedProformaId, setSelectedProformaId] = useState(null);
  const [scanInput, setScanInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [scanError, setScanError] = useState('');
  const [scanStatus, setScanStatus] = useState(null); // 'scanned' ou null

  useEffect(() => {
    saveData();
  }, [proformats]);

  const saveData = async () => {
    try {
      await window.storage.set('lunetterie-proformats', JSON.stringify(proformats));
    } catch (e) {
      console.log('Erreur sauvegarde');
    }
  };

  const selectedProforma = selectedProformaId ? proformats.find(p => p.id === selectedProformaId) : null;

  const handleScanRef = (id, input) => {
    const proforma = proformats.find(p => p.id === id);
    if (!proforma) return;

    if (input.trim().toUpperCase() === proforma.ref.toUpperCase()) {
      setScanError('');
      setScanStatus('scanned');
      setScanInput('');
    } else {
      setScanError('❌ Référence incorrecte ! Essayez encore.');
      setScanInput('');
    }
  };

  const validatePayment = (id) => {
    setProformats(proformats.map(p => p.id === id ? { 
      ...p, 
      status: 'validée',
      paymentMethod: paymentMethod,
    } : p));
    setSelectedProformaId(null);
    setScanInput('');
    setScanStatus(null);
    alert('✅ Paiement enregistré - Labo');
  };

  const confirmReserve = (id) => {
    setProformats(proformats.map(p => p.id === id ? { 
      ...p, 
      status: 'validée',
    } : p));
    setSelectedProformaId(null);
    setScanInput('');
    setScanStatus(null);
    alert('✅ Confirmé - En réserve');
  };

  const proformatEnAttente = proformats.filter(p => p.status === 'en_attente');
  const laboValidées = proformats.filter(p => p.destination === 'labo' && p.status === 'validée');
  const réserveValidées = proformats.filter(p => p.destination === 'reserve' && p.status === 'validée');
  const totalCaisse = laboValidées.reduce((sum, p) => sum + p.price, 0);
  const totalRéserve = réserveValidées.reduce((sum, p) => sum + p.price, 0);
  const totalReçues = proformats.length;
  const totalFacturées = laboValidées.length + réserveValidées.length;

  const downloadInventaire = () => {
    let csv = 'Réf\tClient\tVendeur\tArticles\tDestination\tMontant\tPaiement\tHeure\n';
    proformats.filter(p => p.status === 'validée').forEach(p => {
      const destination = p.destination === 'labo' ? '🔬 Labo (Payé)' : '📦 Réserve (Gratuit)';
      const montant = p.destination === 'labo' ? `${p.price} CFA` : '-';
      const payment = p.paymentMethod ? p.paymentMethod : '-';
      csv += `${p.ref}\t${p.clientName}\t${p.vendeurName}\t${p.montureType} + ${p.verresType}\t${destination}\t${montant}\t${payment}\t${new Date(p.createdAt).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'})}\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventaire-journee-${new Date().toLocaleDateString('fr-FR').replace(/\//g, '-')}.csv`;
    a.click();
  };

  return (
    <div style={{ background: 'linear-gradient(135deg, #f5f7fa 0%, #f0f3f7 100%)', minHeight: '100vh', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        
        {/* Header */}
        <div style={{ marginBottom: '2.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ fontSize: '32px' }}>🛍️</div>
              <div>
                <h1 style={{ fontSize: '28px', fontWeight: 600, margin: '0 0 4px 0', color: '#1a3a3a' }}>Caisse Lunetterie</h1>
                <p style={{ fontSize: '14px', color: '#666', margin: 0 }}>Validation des proformats</p>
              </div>
            </div>
            <div style={{ textAlign: 'right', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
              <div>
                <p style={{ margin: '0 0 4px 0', fontSize: '13px', color: '#666' }}><strong>💳 Encaissé</strong></p>
                <p style={{ margin: 0, fontSize: '24px', fontWeight: 600, color: '#2E7D32' }}>{totalCaisse.toLocaleString()} CFA</p>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#999' }}>{laboValidées.length} labo</p>
              </div>
              <div>
                <p style={{ margin: '0 0 4px 0', fontSize: '13px', color: '#666' }}><strong>📦 Réserve</strong></p>
                <p style={{ margin: 0, fontSize: '24px', fontWeight: 600, color: '#9C27B0' }}>{totalRéserve.toLocaleString()} CFA</p>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#999' }}>{réserveValidées.length} gratuit</p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '8px', borderBottom: '2px solid #e0e0e0', paddingBottom: '0', overflowX: 'auto', flexWrap: 'wrap' }}>
            <button 
              onClick={() => setTab('attente')}
              style={{
                padding: '12px 20px',
                background: tab === 'attente' ? '#FF6B6B' : 'transparent',
                color: tab === 'attente' ? 'white' : '#666',
                border: 'none',
                borderRadius: '8px 8px 0 0',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: tab === 'attente' ? 600 : 500,
                transition: 'all 0.2s',
                whiteSpace: 'nowrap'
              }}
            >
              📋 À traiter ({proformatEnAttente.length})
            </button>
            <button 
              onClick={() => setTab('labo')}
              style={{
                padding: '12px 20px',
                background: tab === 'labo' ? '#2196F3' : 'transparent',
                color: tab === 'labo' ? 'white' : '#666',
                border: 'none',
                borderRadius: '8px 8px 0 0',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: tab === 'labo' ? 600 : 500,
                transition: 'all 0.2s',
                whiteSpace: 'nowrap'
              }}
            >
              🔬 Labo payé ({laboValidées.length})
            </button>
            <button 
              onClick={() => setTab('reserve')}
              style={{
                padding: '12px 20px',
                background: tab === 'reserve' ? '#9C27B0' : 'transparent',
                color: tab === 'reserve' ? 'white' : '#666',
                border: 'none',
                borderRadius: '8px 8px 0 0',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: tab === 'reserve' ? 600 : 500,
                transition: 'all 0.2s',
                whiteSpace: 'nowrap'
              }}
            >
              📦 Réserve ({réserveValidées.length})
            </button>
            <button 
              onClick={() => setTab('inventaire')}
              style={{
                padding: '12px 20px',
                background: tab === 'inventaire' ? '#4CAF50' : 'transparent',
                color: tab === 'inventaire' ? 'white' : '#666',
                border: 'none',
                borderRadius: '8px 8px 0 0',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: tab === 'inventaire' ? 600 : 500,
                transition: 'all 0.2s',
                whiteSpace: 'nowrap'
              }}
            >
              📊 Inventaire
            </button>
          </div>
        </div>

        {/* Onglet À traiter */}
        {tab === 'attente' && (
          <div>
            {!selectedProforma && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '2rem' }}>
                <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '2px solid #FF6B6B' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#666', fontWeight: 600 }}>📥 Reçues</p>
                  <p style={{ margin: 0, fontSize: '28px', fontWeight: 600, color: '#FF6B6B' }}>{totalReçues}</p>
                </div>
                <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '2px solid #4CAF50' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#666', fontWeight: 600 }}>✓ Traité</p>
                  <p style={{ margin: 0, fontSize: '28px', fontWeight: 600, color: '#4CAF50' }}>{totalFacturées}</p>
                </div>
                <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '2px solid #FF9800' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#666', fontWeight: 600 }}>⏳ En attente</p>
                  <p style={{ margin: 0, fontSize: '28px', fontWeight: 600, color: '#FF9800' }}>{proformatEnAttente.length}</p>
                </div>
              </div>
            )}
            {selectedProforma ? (
              // Détail proforma
              <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                <button
                  onClick={() => {
                    setSelectedProformaId(null);
                    setScanInput('');
                    setScanError('');
                    setScanStatus(null);
                  }}
                  style={{
                    padding: '8px 16px',
                    background: '#f0f0f0',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    marginBottom: '2rem',
                    fontWeight: 600
                  }}
                >
                  ← Retour
                </button>

                <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e0e0e0', overflow: 'hidden', marginBottom: '2rem' }}>
                  <div style={{ height: '200px', overflow: 'hidden', background: '#f5f5f5' }}>
                    <img 
                      src={selectedProforma.image} 
                      alt={selectedProforma.montureType}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </div>
                  
                  <div style={{ padding: '2rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                      {/* Infos */}
                      <div>
                        <h3 style={{ margin: '0 0 1rem 0', fontSize: '18px', fontWeight: 600, color: '#1a3a3a' }}>
                          {selectedProforma.clientName}
                        </h3>
                        <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#666' }}>
                          📞 {selectedProforma.phone}
                        </p>
                        <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#666' }}>
                          👤 Vendeur: <strong>{selectedProforma.vendeurName}</strong>
                        </p>
                        <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#666' }}>
                          📌 Réf: <strong>{selectedProforma.ref}</strong>
                        </p>
                        <p style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600, color: '#1a3a3a' }}>
                          {selectedProforma.montureType}
                        </p>
                        <p style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: 600, color: '#1a3a3a' }}>
                          {selectedProforma.verresType}
                        </p>
                        <p style={{ margin: 0, fontSize: '24px', fontWeight: 600, color: '#2E7D32' }}>
                          {selectedProforma.price.toLocaleString()} CFA
                        </p>
                      </div>

                      {/* Traitement */}
                      <div style={{ padding: '2rem', background: selectedProforma.destination === 'labo' ? '#E3F2FD' : '#F3E5F5', borderRadius: '12px', border: '2px solid ' + (selectedProforma.destination === 'labo' ? '#2196F3' : '#9C27B0') }}>
                        <h3 style={{ margin: '0 0 1.5rem 0', fontSize: '18px', fontWeight: 600, color: selectedProforma.destination === 'labo' ? '#1976D2' : '#7B1FA2' }}>
                          {selectedProforma.destination === 'labo' ? '🔬 LABO' : '📦 RÉSERVE'}
                        </h3>

                        {scanStatus === null ? (
                          // Écran SCANNER
                          <div>
                            <p style={{ margin: '0 0 1rem 0', fontSize: '13px', color: '#666' }}>
                              Scannez ou entrez la réf {selectedProforma.ref}
                            </p>
                            <input
                              type="text"
                              placeholder={selectedProforma.ref}
                              value={scanInput}
                              onChange={(e) => setScanInput(e.target.value)}
                              onKeyPress={(e) => {
                                if (e.key === 'Enter' && scanInput.trim()) {
                                  handleScanRef(selectedProforma.id, scanInput.trim());
                                }
                              }}
                              autoFocus
                              style={{
                                width: '100%',
                                padding: '12px',
                                border: '2px solid ' + (selectedProforma.destination === 'labo' ? '#2196F3' : '#9C27B0'),
                                borderRadius: '6px',
                                fontSize: '16px',
                                marginBottom: '10px',
                                boxSizing: 'border-box',
                                outline: 'none',
                                fontWeight: 600
                              }}
                            />
                            <button
                              onClick={() => handleScanRef(selectedProforma.id, scanInput.trim())}
                              disabled={!scanInput.trim()}
                              style={{
                                width: '100%',
                                padding: '10px',
                                background: scanInput.trim() ? (selectedProforma.destination === 'labo' ? '#2196F3' : '#9C27B0') : '#ccc',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                fontSize: '13px',
                                fontWeight: 600,
                                cursor: scanInput.trim() ? 'pointer' : 'not-allowed'
                              }}
                            >
                              🔍 Valider le scan
                            </button>

                            {scanError && (
                              <div style={{ marginTop: '10px', padding: '10px', background: '#FFEBEE', borderRadius: '6px', color: '#C62828', fontWeight: 600, fontSize: '12px' }}>
                                {scanError}
                              </div>
                            )}
                          </div>
                        ) : (
                          // Après scan réussi
                          <div>
                            <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', marginBottom: '1rem', textAlign: 'center', border: '2px solid #4CAF50' }}>
                              <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#666' }}>✓ Référence validée</p>
                              <p style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#4CAF50' }}>
                                {selectedProforma.ref}
                              </p>
                            </div>

                            {selectedProforma.destination === 'labo' ? (
                              // LABO → Encaisser
                              <div>
                                <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', marginBottom: '1rem', textAlign: 'center' }}>
                                  <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#666' }}>Montant à encaisser</p>
                                  <p style={{ margin: 0, fontSize: '28px', fontWeight: 600, color: '#2E7D32' }}>
                                    {selectedProforma.price.toLocaleString()} CFA
                                  </p>
                                </div>

                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#1a3a3a', marginBottom: '8px' }}>
                                  💳 Mode de paiement
                                </label>
                                <select
                                  value={paymentMethod}
                                  onChange={(e) => setPaymentMethod(e.target.value)}
                                  style={{
                                    width: '100%',
                                    padding: '10px',
                                    border: '1px solid #e0e0e0',
                                    borderRadius: '6px',
                                    marginBottom: '1rem',
                                    fontSize: '12px',
                                    background: 'white',
                                    cursor: 'pointer',
                                    outline: 'none'
                                  }}
                                >
                                  <option value="Cash">💵 Cash</option>
                                  <option value="Mutuelle">🏥 Mutuelle</option>
                                  <option value="Chèque">📄 Chèque</option>
                                  <option value="Mobile Money">📱 Mobile Money</option>
                                </select>

                                <button
                                  onClick={() => validatePayment(selectedProforma.id)}
                                  style={{
                                    width: '100%',
                                    padding: '12px',
                                    background: '#4CAF50',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    cursor: 'pointer'
                                  }}
                                  onMouseOver={(e) => e.target.style.background = '#388E3C'}
                                  onMouseOut={(e) => e.target.style.background = '#4CAF50'}
                                >
                                  ✓ Encaisser et envoyer au labo
                                </button>
                              </div>
                            ) : (
                              // RÉSERVE → Confirmer
                              <button
                                onClick={() => confirmReserve(selectedProforma.id)}
                                style={{
                                  width: '100%',
                                  padding: '12px',
                                  background: '#9C27B0',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '6px',
                                  fontSize: '14px',
                                  fontWeight: 600,
                                  cursor: 'pointer'
                                }}
                                onMouseOver={(e) => e.target.style.background = '#7B1FA2'}
                                onMouseOut={(e) => e.target.style.background = '#9C27B0'}
                              >
                                ✓ Confirmer l'envoi en réserve
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              // Liste des proformats
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                {proformatEnAttente.map(proforma => (
                  <div
                    key={proforma.id}
                    onClick={() => {
                      setSelectedProformaId(proforma.id);
                      setScanStatus(null);
                      setScanInput('');
                      setScanError('');
                    }}
                    style={{
                      background: 'white',
                      borderRadius: '12px',
                      overflow: 'hidden',
                      border: '2px solid #FF6B6B',
                      cursor: 'pointer',
                      transition: 'all 0.3s',
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.boxShadow = '0 8px 20px rgba(255, 107, 107, 0.2)';
                      e.currentTarget.style.transform = 'translateY(-4px)';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.05)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    <div style={{ height: '120px', overflow: 'hidden', background: '#f5f5f5' }}>
                      <img 
                        src={proforma.image} 
                        alt={proforma.montureType}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    </div>

                    <div style={{ padding: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                        <h3 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600, color: '#1a3a3a' }}>
                          {proforma.clientName}
                        </h3>
                        <span style={{
                          background: proforma.destination === 'labo' ? '#E3F2FD' : '#F3E5F5',
                          color: proforma.destination === 'labo' ? '#1976D2' : '#7B1FA2',
                          padding: '4px 10px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 600,
                          whiteSpace: 'nowrap'
                        }}>
                          {proforma.destination === 'labo' ? '🔬 Labo' : '📦 Réserve'}
                        </span>
                      </div>

                      <p style={{ margin: '0 0 6px 0', fontSize: '11px', color: '#666' }}>
                        📌 {proforma.ref}
                      </p>
                      <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#666', lineHeight: '1.4' }}>
                        {proforma.montureType}
                      </p>

                      <div style={{ borderTop: '1px solid #e0e0e0', paddingTop: '10px' }}>
                        <p style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#2E7D32' }}>
                          {proforma.price.toLocaleString()} CFA
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {proformatEnAttente.length === 0 && !selectedProforma && (
              <div style={{ textAlign: 'center', padding: '3rem 2rem', color: '#999' }}>
                <p style={{ fontSize: '16px' }}>✅ Aucune proforma à traiter</p>
              </div>
            )}
          </div>
        )}

        {/* Onglet Labo */}
        {tab === 'labo' && (
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e0e0e0', overflow: 'hidden' }}>
            <div style={{ padding: '2rem', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#1a3a3a' }}>🔬 Labo - Payé ({laboValidées.length})</h3>
              <div style={{ textAlign: 'right' }}>
                <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: '#666' }}>Total encaissé</p>
                <p style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#2E7D32' }}>{totalCaisse.toLocaleString()} CFA</p>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #e0e0e0' }}>
                    <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600 }}>Client</th>
                    <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600 }}>Réf</th>
                    <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600 }}>Articles</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontWeight: 600 }}>Montant</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontWeight: 600 }}>Paiement</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontWeight: 600 }}>Heure</th>
                  </tr>
                </thead>
                <tbody>
                  {laboValidées.map((p, idx) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #e0e0e0', background: idx % 2 === 0 ? 'white' : '#f9f9f9' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 500 }}>{p.clientName}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: '#666' }}>{p.ref}</td>
                      <td style={{ padding: '10px 12px', fontSize: '12px', color: '#666' }}>
                        {p.montureType.substring(0, 20)}...
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: '#2E7D32' }}>
                        {p.price.toLocaleString()} CFA
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          borderRadius: '10px',
                          fontSize: '11px',
                          fontWeight: 600,
                          background: p.paymentMethod === 'Cash' ? '#FFF3E0' : p.paymentMethod === 'Mutuelle' ? '#E8F5E9' : p.paymentMethod === 'Chèque' ? '#F3E5F5' : '#E3F2FD',
                          color: p.paymentMethod === 'Cash' ? '#E65100' : p.paymentMethod === 'Mutuelle' ? '#2E7D32' : p.paymentMethod === 'Chèque' ? '#7B1FA2' : '#1976D2',
                        }}>
                          {p.paymentMethod}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#666', fontSize: '12px' }}>
                        {new Date(p.createdAt).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'})}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {laboValidées.length === 0 && (
              <div style={{ textAlign: 'center', padding: '3rem 2rem', color: '#999' }}>
                <p>Aucune vente au labo</p>
              </div>
            )}
          </div>
        )}

        {/* Onglet Réserve */}
        {tab === 'reserve' && (
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e0e0e0', overflow: 'hidden' }}>
            <div style={{ padding: '2rem', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#1a3a3a' }}>📦 Réserve ({réserveValidées.length})</h3>
              <div style={{ textAlign: 'right' }}>
                <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: '#666' }}>Valeur totale</p>
                <p style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#9C27B0' }}>{totalRéserve.toLocaleString()} CFA</p>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #e0e0e0' }}>
                    <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600 }}>Client</th>
                    <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600 }}>Réf</th>
                    <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600 }}>Articles</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontWeight: 600 }}>Statut</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontWeight: 600 }}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {réserveValidées.map((p, idx) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #e0e0e0', background: idx % 2 === 0 ? 'white' : '#f9f9f9' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 500 }}>{p.clientName}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: '#666' }}>{p.ref}</td>
                      <td style={{ padding: '10px 12px', fontSize: '12px', color: '#666' }}>
                        {p.montureType.substring(0, 20)}...
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          borderRadius: '10px',
                          fontSize: '11px',
                          fontWeight: 600,
                          background: '#F3E5F5',
                          color: '#7B1FA2'
                        }}>
                          📦 Réservé
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#666', fontSize: '12px' }}>
                        {new Date(p.createdAt).toLocaleDateString('fr-FR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {réserveValidées.length === 0 && (
              <div style={{ textAlign: 'center', padding: '3rem 2rem', color: '#999' }}>
                <p>Aucune lunette en réserve</p>
              </div>
            )}
          </div>
        )}

        {/* Onglet Inventaire */}
        {tab === 'inventaire' && (
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e0e0e0', overflow: 'hidden' }}>
            <div style={{ padding: '2rem', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#1a3a3a' }}>📊 Inventaire de la journée</h3>
              <button
                onClick={downloadInventaire}
                style={{
                  padding: '10px 16px',
                  background: '#4CAF50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '13px'
                }}
              >
                📥 Excel
              </button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #e0e0e0' }}>
                    <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600 }}>Réf</th>
                    <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600 }}>Client</th>
                    <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600 }}>Vendeur</th>
                    <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600 }}>Articles</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontWeight: 600 }}>Destination</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontWeight: 600 }}>Montant</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontWeight: 600 }}>Paiement</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontWeight: 600 }}>Heure</th>
                  </tr>
                </thead>
                <tbody>
                  {proformats.filter(p => p.status === 'validée').map((p, idx) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #e0e0e0', background: idx % 2 === 0 ? 'white' : '#f9f9f9' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: '#666' }}>{p.ref}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 500 }}>{p.clientName}</td>
                      <td style={{ padding: '10px 12px', color: '#666' }}>{p.vendeurName}</td>
                      <td style={{ padding: '10px 12px', fontSize: '12px', color: '#666' }}>
                        {p.montureType.substring(0, 15)}...
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          borderRadius: '10px',
                          fontSize: '11px',
                          fontWeight: 600,
                          background: p.destination === 'labo' ? '#E3F2FD' : '#F3E5F5',
                          color: p.destination === 'labo' ? '#1976D2' : '#7B1FA2',
                        }}>
                          {p.destination === 'labo' ? '🔬 Labo' : '📦 Réserve'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: p.destination === 'labo' ? '#2E7D32' : '#999' }}>
                        {p.destination === 'labo' ? `${p.price.toLocaleString()} CFA` : '-'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '11px' }}>
                        {p.destination === 'labo' ? (
                          <span style={{
                            background: p.paymentMethod === 'Cash' ? '#FFF3E0' : p.paymentMethod === 'Mutuelle' ? '#E8F5E9' : p.paymentMethod === 'Chèque' ? '#F3E5F5' : '#E3F2FD',
                            color: p.paymentMethod === 'Cash' ? '#E65100' : p.paymentMethod === 'Mutuelle' ? '#2E7D32' : p.paymentMethod === 'Chèque' ? '#7B1FA2' : '#1976D2',
                            padding: '3px 6px',
                            borderRadius: '8px',
                            fontWeight: 600,
                            display: 'inline-block'
                          }}>
                            {p.paymentMethod}
                          </span>
                        ) : '-'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#666', fontSize: '12px' }}>
                        {new Date(p.createdAt).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'})}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {proformats.filter(p => p.status === 'validée').length === 0 && (
              <div style={{ textAlign: 'center', padding: '3rem 2rem', color: '#999' }}>
                <p>Aucun mouvement</p>
              </div>
            )}

            <div style={{ padding: '2rem', background: '#f9f9f9', borderTop: '1px solid #e0e0e0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
              <div>
                <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#666', fontWeight: 600 }}>Total Labo</p>
                <p style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 600, color: '#2E7D32' }}>{totalCaisse.toLocaleString()} CFA</p>
                <p style={{ margin: 0, fontSize: '12px', color: '#999' }}>{laboValidées.length} facture(s)</p>
              </div>
              <div>
                <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#666', fontWeight: 600 }}>Total Réserve</p>
                <p style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 600, color: '#9C27B0' }}>{totalRéserve.toLocaleString()} CFA</p>
                <p style={{ margin: 0, fontSize: '12px', color: '#999' }}>{réserveValidées.length} réservée(s)</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}