import React, { useState, useEffect } from 'react';

const DEMO_CUSTOMERS = [
  // ANCIENS CLIENTS (payés)
  {
    id: 101,
    name: "Marie Dupont",
    type: "ancien",
    phone: "06 12 34 56 78",
    photo: "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=200&h=200&fit=crop",
    purchaseDate: "2022-03-15",
    status: "payé",
    labStatus: "en stock",
    called: true,
    calledDate: "2026-08-08 09:15",
    observations: "Client régulier depuis 2022",
    createdAt: new Date().toISOString(),
  },
  {
    id: 102,
    name: "Sophie Bernard",
    type: "ancien",
    phone: "06 45 67 89 01",
    photo: "https://images.unsplash.com/photo-1559368915-cd4628902d4a?w=200&h=200&fit=crop",
    purchaseDate: "2021-11-10",
    status: "payé",
    labStatus: "enlevée",
    retrievedDate: "2026-08-06",
    called: true,
    calledDate: "2026-08-06 14:30",
    observations: "Satisfait du service",
    createdAt: new Date().toISOString(),
  },
  {
    id: 103,
    name: "Claire Rousseau",
    type: "ancien",
    phone: "06 55 44 33 22",
    photo: "https://images.unsplash.com/photo-1580489944761-b8a0c5a9e7a6?w=200&h=200&fit=crop",
    purchaseDate: "2023-09-22",
    status: "payé",
    labStatus: "enlevée",
    retrievedDate: "2026-08-07",
    called: true,
    calledDate: "2026-08-07 11:00",
    observations: "Monture de remplacement",
    createdAt: new Date().toISOString(),
  },
  {
    id: 104,
    name: "Nathalie Girard",
    type: "ancien",
    phone: "06 77 88 99 00",
    photo: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop",
    purchaseDate: "2020-06-12",
    status: "payé",
    labStatus: "en stock",
    called: false,
    calledDate: null,
    observations: "Verres bifocaux",
    createdAt: new Date().toISOString(),
  },
  {
    id: 105,
    name: "Monique Lefebvre",
    type: "ancien",
    phone: "06 23 45 67 89",
    photo: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop",
    purchaseDate: "2021-02-28",
    status: "payé",
    labStatus: "prêt",
    called: true,
    calledDate: "2026-08-09 10:45",
    observations: "Demande de verres supplémentaires",
    createdAt: new Date().toISOString(),
  },

  // PROFORMATS À RELANCER (non payés)
  {
    id: 201,
    name: "Luc Petit",
    type: "proformat",
    phone: "07 23 45 67 89",
    photo: "https://images.unsplash.com/photo-1525716059541-b48a73047db3?w=200&h=200&fit=crop",
    proformatPhoto: "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=150&h=150&fit=crop",
    purchaseDate: "2024-01-08",
    relanceDate: "2026-08-08",
    paymentDate: null,
    status: "relancé",
    labStatus: "en stock",
    called: false,
    calledDate: null,
    noAnswer: false,
    observations: "Verres de soleil teintés",
    message: "",
    createdAt: new Date().toISOString(),
  },
  {
    id: 202,
    name: "Sophie Martin",
    type: "proformat",
    phone: "07 45 67 89 12",
    photo: "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=200&h=200&fit=crop",
    proformatPhoto: "https://images.unsplash.com/photo-1523821741446-edb429f67505?w=150&h=150&fit=crop",
    purchaseDate: "2024-02-15",
    relanceDate: "2026-08-08",
    paymentDate: null,
    status: "relancé",
    labStatus: "en stock",
    called: true,
    calledDate: "2026-08-08 10:30",
    noAnswer: false,
    observations: "Monture en métal léger",
    message: "",
    createdAt: new Date().toISOString(),
  },
  {
    id: 203,
    name: "Isabelle Moreau",
    type: "proformat",
    phone: "07 55 66 77 88",
    photo: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop",
    proformatPhoto: "https://images.unsplash.com/photo-1523821741446-edb429f67505?w=150&h=150&fit=crop",
    purchaseDate: "2024-09-20",
    relanceDate: "2026-08-08",
    paymentDate: null,
    status: "relancé",
    labStatus: "en stock",
    called: true,
    calledDate: "2026-08-08 14:00",
    noAnswer: true,
    observations: "Verres teintés progressifs",
    message: "Pas de réponse, rappeler demain",
    createdAt: new Date().toISOString(),
  },
  {
    id: 204,
    name: "Jean Martin",
    type: "proformat",
    phone: "07 98 76 54 32",
    photo: "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=200&h=200&fit=crop",
    proformatPhoto: "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=150&h=150&fit=crop",
    purchaseDate: "2024-02-20",
    relanceDate: "2026-08-09",
    paymentDate: null,
    status: "relancé",
    labStatus: "en stock",
    called: false,
    calledDate: null,
    noAnswer: false,
    observations: "Monture verres progressifs",
    message: "",
    createdAt: new Date().toISOString(),
  },
  {
    id: 205,
    name: "Thomas Durand",
    type: "proformat",
    phone: "07 11 22 33 44",
    photo: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop",
    proformatPhoto: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=150&h=150&fit=crop",
    purchaseDate: "2023-10-05",
    relanceDate: "2026-08-09",
    paymentDate: null,
    status: "relancé",
    labStatus: "en stock",
    called: false,
    calledDate: null,
    noAnswer: false,
    observations: "Verres de soleil",
    message: "",
    createdAt: new Date().toISOString(),
  },
  {
    id: 206,
    name: "Marc Fontaine",
    type: "proformat",
    phone: "07 44 55 66 77",
    photo: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop",
    proformatPhoto: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=150&h=150&fit=crop",
    purchaseDate: "2024-10-15",
    relanceDate: "2026-08-09",
    paymentDate: null,
    status: "relancé",
    labStatus: "en stock",
    called: true,
    calledDate: "2026-08-09 11:15",
    noAnswer: false,
    observations: "Monture légère en titane",
    message: "",
    createdAt: new Date().toISOString(),
  },
  {
    id: 207,
    name: "Valérie Lefevre",
    type: "proformat",
    phone: "07 34 56 78 90",
    photo: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop",
    proformatPhoto: "https://images.unsplash.com/photo-1523821741446-edb429f67505?w=150&h=150&fit=crop",
    purchaseDate: "2024-05-10",
    relanceDate: "2026-08-10",
    paymentDate: null,
    status: "relancé",
    labStatus: "en stock",
    called: false,
    calledDate: null,
    noAnswer: false,
    observations: "Monture femme tendance",
    message: "",
    createdAt: new Date().toISOString(),
  },
  {
    id: 208,
    name: "Claude Bernard",
    type: "proformat",
    phone: "07 23 34 45 56",
    photo: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop",
    proformatPhoto: "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=150&h=150&fit=crop",
    purchaseDate: "2024-03-08",
    relanceDate: "2026-08-10",
    paymentDate: null,
    status: "relancé",
    labStatus: "en stock",
    called: true,
    calledDate: "2026-08-10 09:30",
    noAnswer: true,
    observations: "Verres correcteurs puissance élevée",
    message: "Appel urgent demain",
    createdAt: new Date().toISOString(),
  },
  {
    id: 209,
    name: "Pierre Dubois",
    type: "proformat",
    phone: "07 65 74 83 92",
    photo: "https://images.unsplash.com/photo-1502684457256-94f00fa8b5d2?w=200&h=200&fit=crop",
    proformatPhoto: "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=150&h=150&fit=crop",
    purchaseDate: "2024-07-20",
    relanceDate: "2026-08-11",
    paymentDate: null,
    status: "relancé",
    labStatus: "en stock",
    called: false,
    calledDate: null,
    noAnswer: false,
    observations: "Verres anti-lumière bleue",
    message: "",
    createdAt: new Date().toISOString(),
  },
  {
    id: 210,
    name: "Nathalie Gaston",
    type: "proformat",
    phone: "07 92 83 74 65",
    photo: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop",
    proformatPhoto: "https://images.unsplash.com/photo-1523821741446-edb429f67505?w=150&h=150&fit=crop",
    purchaseDate: "2024-04-12",
    relanceDate: "2026-08-11",
    paymentDate: null,
    status: "relancé",
    labStatus: "en stock",
    called: false,
    calledDate: null,
    noAnswer: false,
    observations: "Monture sport",
    message: "",
    createdAt: new Date().toISOString(),
  },
  {
    id: 211,
    name: "Frédéric Roussel",
    type: "proformat",
    phone: "07 18 27 36 45",
    photo: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop",
    proformatPhoto: "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=150&h=150&fit=crop",
    purchaseDate: "2024-06-25",
    relanceDate: "2026-08-12",
    paymentDate: null,
    status: "relancé",
    labStatus: "en stock",
    called: true,
    calledDate: "2026-08-12 15:45",
    noAnswer: false,
    observations: "Client habitué, demande devis souvent",
    message: "",
    createdAt: new Date().toISOString(),
  },
  {
    id: 212,
    name: "Christelle Petit",
    type: "proformat",
    phone: "06 89 78 67 56",
    photo: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop",
    proformatPhoto: "https://images.unsplash.com/photo-1523821741446-edb429f67505?w=150&h=150&fit=crop",
    purchaseDate: "2024-08-01",
    relanceDate: "2026-08-06",
    paymentDate: null,
    status: "relancé",
    labStatus: "prêt",
    called: true,
    calledDate: "2026-08-06 13:20",
    noAnswer: false,
    observations: "Au labo - Appeler pour enlever",
    message: "",
    createdAt: new Date().toISOString(),
  },
];

export default function LunetterieSAV() {
  const [customers, setCustomers] = useState(DEMO_CUSTOMERS);
  const [tab, setTab] = useState('ancien');
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [employeeName, setEmployeeName] = useState('');
  const [editingName, setEditingName] = useState(false);

  useEffect(() => {
    saveData();
  }, [customers]);

  const saveData = async () => {
    try {
      await window.storage.set('lunetterie-customers', JSON.stringify(customers));
      await window.storage.set('lunetterie-employee', employeeName);
    } catch (e) {
      console.log('Erreur sauvegarde');
    }
  };

  const toggleCalled = (id) => {
    setCustomers(customers.map(c => {
      if (c.id === id) {
        const now = new Date();
        const dateStr = now.toLocaleString('fr-FR', { 
          year: 'numeric', 
          month: '2-digit', 
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
        return {
          ...c,
          called: !c.called,
          calledDate: !c.called ? dateStr : null
        };
      }
      return c;
    }));
  };

  const toggleNoAnswer = (id) => {
    setCustomers(customers.map(c => c.id === id ? { ...c, noAnswer: !c.noAnswer } : c));
  };

  const updateObservations = (id, obs) => {
    setCustomers(customers.map(c => c.id === id ? { ...c, observations: obs } : c));
  };

  const updateMessage = (id, msg) => {
    setCustomers(customers.map(c => c.id === id ? { ...c, message: msg } : c));
  };

  const callPhone = (phone) => {
    window.location.href = `tel:${phone}`;
  };

  const markAsRetrieved = (id) => {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    setCustomers(customers.map(c => c.id === id ? { ...c, labStatus: 'enlevée', retrievedDate: dateStr } : c));
  };

  const proformatsNonPayes = customers.filter(c => c.type === 'proformat' && !c.paymentDate);
  const proformatsRelances = customers.filter(c => c.type === 'proformat' && c.relanceDate);
  const proformatsRelancesPayes = proformatsRelances.filter(c => c.paymentDate);
  const retrievedGlasses = customers.filter(c => c.labStatus === 'enlevée');
  const laboCustomers = customers.filter(c => c.labStatus === 'prêt');

  const filteredCustomers = tab === 'proformats' 
    ? proformatsNonPayes.filter(c => (filterStatus === 'all' || c.status === filterStatus) && c.name.toLowerCase().includes(searchText.toLowerCase()))
    : tab === 'ancien'
    ? customers.filter(c => c.type === 'ancien' && c.name.toLowerCase().includes(searchText.toLowerCase()))
    : null;

  const calculateDaysToPayment = (relanceDate, paymentDate) => {
    if (!relanceDate || !paymentDate) return null;
    const relance = new Date(relanceDate);
    const payment = new Date(paymentDate);
    return Math.floor((payment - relance) / (1000 * 60 * 60 * 24));
  };

  const jours = proformatsRelancesPayes.map(c => calculateDaysToPayment(c.relanceDate, c.paymentDate)).filter(Boolean);
  const joursAverage = jours.length > 0 ? Math.round(jours.reduce((a, b) => a + b, 0) / jours.length) : 0;
  const joursMin = jours.length > 0 ? Math.min(...jours) : 0;
  const joursMax = jours.length > 0 ? Math.max(...jours) : 0;
  const tauxConversion = proformatsRelances.length > 0 ? Math.round((proformatsRelancesPayes.length / proformatsRelances.length) * 100) : 0;

  const getDaysInMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const statusColors = {
    'payé': { bg: '#E8F5E9', text: '#2E7D32', label: 'Payé' },
    'en attente': { bg: '#FFF3E0', text: '#E65100', label: 'En attente' },
    'relancé': { bg: '#FCE4EC', text: '#C2185B', label: 'Relancé' },
  };

  const daysOfWeek = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const daysInMonth = getDaysInMonth(currentMonth);
  const firstDay = getFirstDayOfMonth(currentMonth);
  const days = [];
  
  for (let i = 0; i < firstDay; i++) {
    days.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i);
  }

  return (
    <div style={{ background: 'linear-gradient(135deg, #f5f7fa 0%, #f0f3f7 100%)', minHeight: '100vh', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        
        {/* Header */}
        <div style={{ marginBottom: '2.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ fontSize: '32px' }}>👓</div>
              <div>
                <h1 style={{ fontSize: '28px', fontWeight: 600, margin: '0 0 4px 0', color: '#1a3a3a' }}>Suivi SAV</h1>
                <p style={{ fontSize: '14px', color: '#666', margin: 0 }}>
                  {editingName ? (
                    <input
                      type="text"
                      value={employeeName}
                      onChange={(e) => setEmployeeName(e.target.value)}
                      onBlur={() => setEditingName(false)}
                      onKeyPress={(e) => e.key === 'Enter' && setEditingName(false)}
                      autoFocus
                      style={{
                        padding: '4px 8px',
                        border: '1px solid #00897b',
                        borderRadius: '4px',
                        fontSize: '14px',
                        fontWeight: 500,
                        color: '#00897b'
                      }}
                      placeholder="Ton prénom..."
                    />
                  ) : (
                    <span 
                      onClick={() => setEditingName(true)}
                      style={{ cursor: 'pointer', color: '#00897b', fontWeight: 500 }}
                    >
                      {employeeName ? `👤 ${employeeName}` : '👤 Clic pour ajouter ton prénom'}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: '13px', color: '#666' }}>
              <p style={{ margin: '0 0 4px 0' }}><strong>📞 Appels aujourd'hui :</strong></p>
              <p style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#00897b' }}>
                {customers.filter(c => {
                  if (!c.calledDate) return false;
                  const today = new Date().toISOString().split('T')[0];
                  return c.calledDate.startsWith(today);
                }).length}
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '8px', borderBottom: '2px solid #e0e0e0', paddingBottom: '0', overflowX: 'auto', flexWrap: 'wrap' }}>
            <button 
              onClick={() => { setTab('ancien'); setFilterStatus('all'); }}
              style={{
                padding: '12px 20px',
                background: tab === 'ancien' ? '#00897b' : 'transparent',
                color: tab === 'ancien' ? 'white' : '#666',
                border: 'none',
                borderRadius: '8px 8px 0 0',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: tab === 'ancien' ? 600 : 500,
                transition: 'all 0.2s',
                whiteSpace: 'nowrap'
              }}
            >
              Anciens clients
            </button>
            <button 
              onClick={() => { setTab('proformats'); setFilterStatus('all'); }}
              style={{
                padding: '12px 20px',
                background: tab === 'proformats' ? '#00897b' : 'transparent',
                color: tab === 'proformats' ? 'white' : '#666',
                border: 'none',
                borderRadius: '8px 8px 0 0',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: tab === 'proformats' ? 600 : 500,
                transition: 'all 0.2s',
                whiteSpace: 'nowrap'
              }}
            >
              Proformats à relancer ({proformatsNonPayes.length})
            </button>
            <button 
              onClick={() => setTab('labo')}
              style={{
                padding: '12px 20px',
                background: tab === 'labo' ? '#00897b' : 'transparent',
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
              🔬 Labo prêtes ({laboCustomers.length})
            </button>
            <button 
              onClick={() => setTab('recuperees')}
              style={{
                padding: '12px 20px',
                background: tab === 'recuperees' ? '#00897b' : 'transparent',
                color: tab === 'recuperees' ? 'white' : '#666',
                border: 'none',
                borderRadius: '8px 8px 0 0',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: tab === 'recuperees' ? 600 : 500,
                transition: 'all 0.2s',
                whiteSpace: 'nowrap'
              }}
            >
              ✓ Récupérées ({retrievedGlasses.length})
            </button>
            <button 
              onClick={() => setTab('calendrier')}
              style={{
                padding: '12px 20px',
                background: tab === 'calendrier' ? '#00897b' : 'transparent',
                color: tab === 'calendrier' ? 'white' : '#666',
                border: 'none',
                borderRadius: '8px 8px 0 0',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: tab === 'calendrier' ? 600 : 500,
                transition: 'all 0.2s',
                whiteSpace: 'nowrap'
              }}
            >
              📅 Calendrier
            </button>
            <button 
              onClick={() => setTab('suivi')}
              style={{
                padding: '12px 20px',
                background: tab === 'suivi' ? '#00897b' : 'transparent',
                color: tab === 'suivi' ? 'white' : '#666',
                border: 'none',
                borderRadius: '8px 8px 0 0',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: tab === 'suivi' ? 600 : 500,
                transition: 'all 0.2s',
                whiteSpace: 'nowrap'
              }}
            >
              📊 KPI
            </button>
          </div>
        </div>

        {/* Filters */}
        {tab !== 'suivi' && tab !== 'labo' && tab !== 'recuperees' && tab !== 'calendrier' && (
          <div style={{ display: 'flex', gap: '12px', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Rechercher un client..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{
                padding: '10px 14px',
                border: '1px solid #d0d0d0',
                borderRadius: '8px',
                fontSize: '14px',
                flex: 1,
                minWidth: '180px',
                background: 'white',
                outline: 'none'
              }}
            />
            {tab === 'proformats' && (
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                style={{
                  padding: '10px 14px',
                  border: '1px solid #d0d0d0',
                  borderRadius: '8px',
                  fontSize: '14px',
                  background: 'white',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="all">Tous les statuts</option>
                <option value="en attente">En attente</option>
                <option value="relancé">Relancé</option>
              </select>
            )}
          </div>
        )}

        {/* KPI Proformats */}
        {tab === 'suivi' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '2rem' }}>
              <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e0e0e0', textAlign: 'center' }}>
                <p style={{ fontSize: '12px', color: '#666', margin: '0 0 12px 0', fontWeight: 600 }}>Total proformats</p>
                <p style={{ fontSize: '32px', fontWeight: 600, margin: 0, color: '#00897b' }}>{customers.filter(c => c.type === 'proformat').length}</p>
              </div>
              <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e0e0e0', textAlign: 'center' }}>
                <p style={{ fontSize: '12px', color: '#666', margin: '0 0 12px 0', fontWeight: 600 }}>Proformats relancés</p>
                <p style={{ fontSize: '32px', fontWeight: 600, margin: 0, color: '#E65100' }}>{proformatsRelances.length}</p>
              </div>
              <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e0e0e0', textAlign: 'center' }}>
                <p style={{ fontSize: '12px', color: '#666', margin: '0 0 12px 0', fontWeight: 600 }}>Payés après relance</p>
                <p style={{ fontSize: '32px', fontWeight: 600, margin: 0, color: '#2E7D32' }}>{proformatsRelancesPayes.length}</p>
              </div>
              <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e0e0e0', textAlign: 'center' }}>
                <p style={{ fontSize: '12px', color: '#666', margin: '0 0 12px 0', fontWeight: 600 }}>Taux de conversion</p>
                <p style={{ fontSize: '32px', fontWeight: 600, margin: 0, color: '#00897b' }}>{tauxConversion}%</p>
              </div>
            </div>

            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e0e0e0', padding: '2rem', marginBottom: '2rem' }}>
              <h3 style={{ margin: '0 0 1.5rem 0', fontSize: '18px', fontWeight: 600, color: '#1a3a3a' }}>📊 Conversion des proformats relancés</h3>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3rem', flexWrap: 'wrap' }}>
                <svg style={{ width: '200px', height: '200px' }} viewBox="0 0 200 200">
                  <circle cx="100" cy="100" r="90" fill="none" stroke="#e0e0e0" strokeWidth="20" />
                  <circle 
                    cx="100" 
                    cy="100" 
                    r="90" 
                    fill="none" 
                    stroke="#2E7D32" 
                    strokeWidth="20"
                    strokeDasharray={`${(proformatsRelancesPayes.length / (proformatsRelances.length || 1)) * 565.48} 565.48`}
                    strokeDashoffset="0"
                    style={{ transform: 'rotate(-90deg)', transformOrigin: '100px 100px' }}
                  />
                  <text x="100" y="95" textAnchor="middle" fontSize="24" fontWeight="600" fill="#1a3a3a">{tauxConversion}%</text>
                  <text x="100" y="115" textAnchor="middle" fontSize="12" fill="#666">Conversion</text>
                </svg>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                    <div style={{ width: '20px', height: '20px', background: '#2E7D32', borderRadius: '4px' }}></div>
                    <div>
                      <p style={{ margin: 0, fontWeight: 600, color: '#1a3a3a' }}>✓ Payés</p>
                      <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#666' }}>{proformatsRelancesPayes.length} proformats</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '20px', height: '20px', background: '#E0E0E0', borderRadius: '4px' }}></div>
                    <div>
                      <p style={{ margin: 0, fontWeight: 600, color: '#1a3a3a' }}>⏳ En attente</p>
                      <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#666' }}>{proformatsRelances.length - proformatsRelancesPayes.length} proformats</p>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid #e0e0e0' }}>
                <p style={{ margin: '0 0 1rem 0', fontSize: '14px', color: '#333' }}>
                  <strong>📈 Analyse :</strong> {tauxConversion >= 70 ? '✅ Excellent taux de conversion ! Vos relances fonctionnent bien.' : tauxConversion >= 50 ? '⚠️ Bon taux, mais il y a de la marge pour améliorer vos relances.' : tauxConversion > 0 ? '❌ Taux faible. Intensifiez vos relances et changez votre approche.' : '📭 Aucun paiement encore. Commencez les relances !'}
                </p>
              </div>
            </div>

            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e0e0e0', padding: '2rem', marginBottom: '2rem' }}>
              <h3 style={{ margin: '0 0 1.5rem 0', fontSize: '18px', fontWeight: 600, color: '#1a3a3a' }}>⏱️ Durée entre relance et paiement</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '1.5rem' }}>
                <div style={{ background: '#F5F5F5', padding: '1.5rem', borderRadius: '12px', textAlign: 'center', borderLeft: '4px solid #2E7D32' }}>
                  <p style={{ fontSize: '13px', color: '#666', margin: '0 0 8px 0', fontWeight: 600 }}>Moyenne</p>
                  <p style={{ fontSize: '28px', fontWeight: 600, margin: 0, color: '#2E7D32' }}>{joursAverage}</p>
                  <p style={{ fontSize: '12px', color: '#999', margin: '4px 0 0 0' }}>jours</p>
                </div>
                <div style={{ background: '#F5F5F5', padding: '1.5rem', borderRadius: '12px', textAlign: 'center', borderLeft: '4px solid #00897b' }}>
                  <p style={{ fontSize: '13px', color: '#666', margin: '0 0 8px 0', fontWeight: 600 }}>Plus rapide</p>
                  <p style={{ fontSize: '28px', fontWeight: 600, margin: 0, color: '#00897b' }}>{joursMin}</p>
                  <p style={{ fontSize: '12px', color: '#999', margin: '4px 0 0 0' }}>jours</p>
                </div>
                <div style={{ background: '#F5F5F5', padding: '1.5rem', borderRadius: '12px', textAlign: 'center', borderLeft: '4px solid #E65100' }}>
                  <p style={{ fontSize: '13px', color: '#666', margin: '0 0 8px 0', fontWeight: 600 }}>Plus long</p>
                  <p style={{ fontSize: '28px', fontWeight: 600, margin: 0, color: '#E65100' }}>{joursMax}</p>
                  <p style={{ fontSize: '12px', color: '#999', margin: '4px 0 0 0' }}>jours</p>
                </div>
              </div>

              <div style={{ paddingTop: '1rem', borderTop: '1px solid #e0e0e0' }}>
                <p style={{ margin: '0 0 1rem 0', fontSize: '14px', color: '#333' }}>
                  <strong>💡 Insight timing :</strong> 
                  {joursAverage <= 7 ? ' ✅ Vos clients décident très vite ! Continuez ainsi.' : joursAverage <= 14 ? ' ⚠️ Délai normal. Relancez à J+3 et J+7 pour accélérer.' : ' ❌ Délai long. Les clients hésitent. Proposez des solutions alternatives (paiement échelonné, essai).'}
                </p>
              </div>
            </div>

            <div style={{ background: '#E8F5E9', borderRadius: '12px', border: '1px solid #4CAF50', padding: '1.5rem' }}>
              <h3 style={{ margin: '0 0 1rem 0', fontSize: '16px', fontWeight: 600, color: '#2E7D32' }}>🎯 Efficacité de vos relances</h3>
              <div style={{ display: 'grid', gap: '12px', fontSize: '14px', color: '#333' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span><strong>Relances lancées :</strong></span>
                  <span style={{ fontWeight: 600, color: '#E65100' }}>{proformatsRelances.length}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span><strong>Paiements reçus :</strong></span>
                  <span style={{ fontWeight: 600, color: '#2E7D32' }}>{proformatsRelancesPayes.length}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span><strong>Clients appelés :</strong></span>
                  <span style={{ fontWeight: 600 }}>{proformatsRelances.filter(p => p.called).length} / {proformatsRelances.length}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span><strong>Pas de réponse :</strong></span>
                  <span style={{ fontWeight: 600, color: '#C62828' }}>{proformatsRelances.filter(p => p.noAnswer).length}</span>
                </div>
                <div style={{ marginTop: '8px', paddingTop: '12px', borderTop: '1px solid rgba(76, 175, 80, 0.3)' }}>
                  <p style={{ margin: 0, fontSize: '13px', fontStyle: 'italic' }}>
                    {proformatsRelances.filter(p => p.called).length === proformatsRelances.length ? '✅ Vous avez appelé tous les clients en attente !' : `⚠️ ${proformatsRelances.length - proformatsRelances.filter(p => p.called).length} client(s) à appeler`}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Calendrier - Proformats à relancer jour par jour */}
        {tab === 'calendrier' && (
          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '2rem', alignItems: 'start' }}>
            {/* Petit Calendrier - Filtre */}
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e0e0e0', padding: '1.5rem', position: 'sticky', top: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <button 
                  onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
                  style={{ padding: '4px 8px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                >
                  ←
                </button>
                <h3 style={{ fontSize: '14px', fontWeight: 600, margin: 0, color: '#1a3a3a' }}>
                  {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
                </h3>
                <button 
                  onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
                  style={{ padding: '4px 8px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                >
                  →
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '8px' }}>
                {daysOfWeek.map(day => (
                  <div key={day} style={{ textAlign: 'center', fontWeight: 600, color: '#999', padding: '4px 0', fontSize: '11px' }}>
                    {day}
                  </div>
                ))}
                
                {days.map((day, idx) => {
                  const dateStr = day ? `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
                  const proformatsForDay = day ? proformatsNonPayes.filter(p => {
                    if (!p.relanceDate) return false;
                    return p.relanceDate.startsWith(dateStr);
                  }) : [];
                  const isSelected = selectedDate === dateStr;

                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedDate(dateStr)}
                      style={{
                        padding: '8px 4px',
                        border: isSelected ? '2px solid #00897b' : day ? '1px solid #e0e0e0' : 'none',
                        borderRadius: '6px',
                        background: isSelected ? '#E0F2F1' : proformatsForDay.length > 0 ? '#FCE4EC' : day ? 'white' : 'transparent',
                        color: isSelected ? '#00897b' : '#333',
                        cursor: day ? 'pointer' : 'default',
                        fontSize: '12px',
                        fontWeight: isSelected ? 600 : 500,
                        transition: 'all 0.2s',
                        minHeight: '32px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      {day && <div>{day}</div>}
                    </button>
                  );
                })}
              </div>

              <div style={{ paddingTop: '12px', borderTop: '1px solid #e0e0e0', marginTop: '12px', fontSize: '12px', color: '#666' }}>
                <p style={{ margin: '0 0 8px 0', fontWeight: 600 }}>Légende :</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <div style={{ width: '16px', height: '16px', background: '#FCE4EC', borderRadius: '3px' }}></div>
                  <span>À relancer</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '16px', height: '16px', background: '#E0F2F1', borderRadius: '3px' }}></div>
                  <span>Sélectionné</span>
                </div>
              </div>
            </div>

            {/* Liste détaillée des appels du jour */}
            <div>
              {selectedDate && (
                <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e0e0e0', padding: '2rem' }}>
                  <h2 style={{ margin: '0 0 1.5rem 0', fontSize: '20px', fontWeight: 600, color: '#1a3a3a' }}>
                    📞 Appels à faire - {new Date(selectedDate).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </h2>

                  {(() => {
                    const dateStr = selectedDate;
                    const proformatsForDay = proformatsNonPayes.filter(p => {
                      if (!p.relanceDate) return false;
                      return p.relanceDate.startsWith(dateStr);
                    });

                    if (proformatsForDay.length === 0) {
                      return (
                        <div style={{ textAlign: 'center', padding: '3rem 2rem', color: '#999' }}>
                          <p style={{ fontSize: '16px', margin: 0 }}>✅ Aucun appel à faire ce jour</p>
                        </div>
                      );
                    }

                    return (
                      <div style={{ display: 'grid', gap: '16px' }}>
                        {proformatsForDay.map(customer => {
                          const daysDifference = Math.floor((new Date(selectedDate) - new Date(customer.relanceDate)) / (1000 * 60 * 60 * 24));
                          const isReported = daysDifference > 0;
                          
                          return (
                            <div 
                              key={customer.id}
                              style={{
                                background: customer.called ? '#E8F5E9' : '#FFF3E0',
                                borderLeft: customer.called ? '4px solid #4CAF50' : isReported ? '4px solid #E65100' : '4px solid #FF9800',
                                padding: '1.5rem',
                                borderRadius: '8px',
                                display: 'grid',
                                gridTemplateColumns: '1fr auto',
                                gap: '2rem',
                                alignItems: 'start',
                                position: 'relative'
                              }}
                            >
                              {isReported && !customer.called && (
                                <div style={{
                                  position: 'absolute',
                                  top: '12px',
                                  right: '12px',
                                  background: '#E65100',
                                  color: 'white',
                                  padding: '4px 10px',
                                  borderRadius: '12px',
                                  fontSize: '11px',
                                  fontWeight: 600
                                }}>
                                  ⚠️ Reporté ({daysDifference}j)
                                </div>
                              )}
                              
                              <div style={{ paddingRight: isReported && !customer.called ? '100px' : 0 }}>
                                <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: 600, color: '#1a3a3a' }}>
                                  {customer.called ? '✓' : '📞'} {customer.name}
                                </h3>
                                <p style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#666' }}>
                                  <strong>Téléphone :</strong> {' '}
                                  <a href={`tel:${customer.phone}`} style={{ color: '#00897b', textDecoration: 'none', fontWeight: 600 }}>
                                    {customer.phone}
                                  </a>
                                </p>
                                <p style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#666' }}>
                                  <strong>Statut :</strong> {customer.called ? '✓ Appelé(e) aujourd\'hui' : 'À appeler'}
                                </p>
                                
                                {customer.proformatPhoto && (
                                  <div style={{ marginTop: '12px' }}>
                                    <p style={{ fontSize: '12px', color: '#666', fontWeight: 600, margin: '0 0 8px 0' }}>Modèle proformat :</p>
                                    <img src={customer.proformatPhoto} alt="Proformat" style={{ width: '100px', borderRadius: '6px', height: '80px', objectFit: 'cover' }} />
                                  </div>
                                )}

                                {customer.called && customer.noAnswer && (
                                  <div style={{ marginTop: '12px', padding: '10px', background: '#FFEBEE', borderRadius: '6px', borderLeft: '3px solid #C62828' }}>
                                    <p style={{ margin: 0, fontSize: '13px', color: '#C62828', fontWeight: 600 }}>❌ Pas de réponse</p>
                                    {customer.message && <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#666' }}>{customer.message}</p>}
                                  </div>
                                )}

                                {customer.observations && (
                                  <div style={{ marginTop: '12px', padding: '10px', background: '#f5f5f5', borderRadius: '6px' }}>
                                    <p style={{ margin: 0, fontSize: '12px', color: '#666', fontWeight: 600 }}>📝 Notes :</p>
                                    <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#333' }}>{customer.observations}</p>
                                  </div>
                                )}
                              </div>

                              <div>
                                <img src={customer.photo} alt={customer.name} style={{ width: '100px', height: '100px', borderRadius: '8px', objectFit: 'cover' }} />
                              </div>
                            </div>
                          );
                        })}

                        <div style={{ marginTop: '1.5rem', padding: '1.5rem', background: '#FFF9E6', borderRadius: '8px', border: '1px solid #FFB300' }}>
                          <p style={{ margin: 0, fontSize: '13px', color: '#FF8C00', fontWeight: 600 }}>
                            📊 {proformatsForDay.filter(p => p.called).length} / {proformatsForDay.length} appelé(s)
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {!selectedDate && (
                <div style={{ background: '#E0F2F1', borderRadius: '12px', border: '1px solid #4CAF50', padding: '2rem', textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: '16px', color: '#00897b', fontWeight: 600 }}>
                    👈 Sélectionne un jour dans le calendrier pour voir les appels à faire
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Lunettes Récupérées */}
        {tab === 'recuperees' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
            {retrievedGlasses.map(customer => (
              <div 
                key={customer.id}
                style={{
                  background: 'white',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  border: '2px solid #4CAF50',
                  boxShadow: '0 4px 12px rgba(76, 175, 80, 0.15)',
                }}
              >
                <div style={{ position: 'relative', height: '160px', overflow: 'hidden', background: '#f5f5f5' }}>
                  <img 
                    src={customer.photo} 
                    alt={customer.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  <div style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    background: '#E8F5E9',
                    color: '#2E7D32',
                    padding: '8px 14px',
                    borderRadius: '20px',
                    fontSize: '13px',
                    fontWeight: 600
                  }}>
                    ✓ Enlevée
                  </div>
                </div>

                <div style={{ padding: '16px' }}>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 600, color: '#1a3a3a' }}>
                    {customer.name}
                  </h3>
                  <p style={{ fontSize: '13px', color: '#999', margin: '0 0 8px 0' }}>
                    📅 Enlevée le {new Date(customer.retrievedDate).toLocaleDateString('fr-FR')}
                  </p>
                  <p style={{ fontSize: '13px', color: '#666', margin: '0 0 12px 0', fontWeight: 500 }}>
                    {customer.observations}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'recuperees' && retrievedGlasses.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '3rem 2rem',
            color: '#999',
            fontSize: '15px'
          }}>
            <p>Aucune monture récupérée pour le moment</p>
          </div>
        )}

        {/* Labo - Montures Prêtes */}
        {tab === 'labo' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
            {laboCustomers.map(customer => (
              <div 
                key={customer.id}
                style={{
                  background: 'white',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  border: '2px solid #4CAF50',
                  boxShadow: '0 4px 12px rgba(76, 175, 80, 0.15)',
                }}
              >
                <div style={{ position: 'relative', height: '160px', overflow: 'hidden', background: '#f5f5f5' }}>
                  <img 
                    src={customer.photo} 
                    alt={customer.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  <div style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    background: '#E8F5E9',
                    color: '#2E7D32',
                    padding: '8px 14px',
                    borderRadius: '20px',
                    fontSize: '13px',
                    fontWeight: 600
                  }}>
                    ✓ Prête au labo
                  </div>
                </div>

                <div style={{ padding: '16px' }}>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 600, color: '#1a3a3a' }}>
                    {customer.name}
                  </h3>
                  <button
                    onClick={() => callPhone(customer.phone)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      background: '#4CAF50',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      marginBottom: '12px'
                    }}
                    onMouseOver={(e) => e.target.style.background = '#388E3C'}
                    onMouseOut={(e) => e.target.style.background = '#4CAF50'}
                  >
                    📞 Appeler - {customer.phone}
                  </button>

                  {customer.proformatPhoto && (
                    <div style={{ marginBottom: '12px' }}>
                      <p style={{ fontSize: '12px', color: '#666', fontWeight: 600, margin: '0 0 6px 0' }}>Modèle commandé :</p>
                      <img src={customer.proformatPhoto} alt="Proformat" style={{ width: '100%', borderRadius: '6px', height: '120px', objectFit: 'cover' }} />
                    </div>
                  )}

                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px',
                    background: customer.called ? '#E8F5E9' : '#f9f9f9',
                    borderRadius: '8px',
                    marginBottom: '12px',
                    cursor: 'pointer'
                  }}
                  onClick={() => toggleCalled(customer.id)}
                  >
                    <input
                      type="checkbox"
                      checked={customer.called}
                      onChange={() => {}}
                      style={{
                        width: '18px',
                        height: '18px',
                        cursor: 'pointer',
                        accentColor: '#4CAF50'
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: '13px', fontWeight: 500, margin: 0, color: customer.called ? '#2E7D32' : '#666' }}>
                        {customer.called ? '✓ Appelé(e)' : 'À appeler'}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => markAsRetrieved(customer.id)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      background: '#2E7D32',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                    onMouseOver={(e) => e.target.style.background = '#1B5E20'}
                    onMouseOut={(e) => e.target.style.background = '#2E7D32'}
                  >
                    ✓ Marquée comme enlevée
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'labo' && laboCustomers.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '3rem 2rem',
            color: '#999',
            fontSize: '15px',
            background: 'white',
            borderRadius: '12px'
          }}>
            <p>🎉 Aucune monture en attente au labo</p>
          </div>
        )}

        {/* Customers Grid */}
        {(tab === 'ancien' || tab === 'proformats') && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
            {filteredCustomers && filteredCustomers.map(customer => (
              <div 
                key={customer.id}
                style={{
                  background: 'white',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  border: customer.called ? '2px solid #00897b' : '1px solid #e0e0e0',
                  transition: 'all 0.3s',
                  boxShadow: customer.called ? '0 4px 12px rgba(0, 137, 123, 0.15)' : '0 2px 8px rgba(0,0,0,0.05)',
                }}
              >
                {/* Image */}
                <div style={{ position: 'relative', height: '160px', overflow: 'hidden', background: '#f5f5f5' }}>
                  <img 
                    src={customer.photo} 
                    alt={customer.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  <div style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    background: statusColors[customer.status].bg,
                    color: statusColors[customer.status].text,
                    padding: '6px 12px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: 600
                  }}>
                    {statusColors[customer.status].label}
                  </div>
                </div>

                {/* Content */}
                <div style={{ padding: '16px' }}>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 600, color: '#1a3a3a' }}>
                    {customer.name}
                  </h3>
                  <button
                    onClick={() => callPhone(customer.phone)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      background: '#00897b',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      marginBottom: '12px'
                    }}
                    onMouseOver={(e) => e.target.style.background = '#006b63'}
                    onMouseOut={(e) => e.target.style.background = '#00897b'}
                  >
                    📞 {customer.phone}
                  </button>

                  {customer.proformatPhoto && (
                    <div style={{ marginBottom: '12px' }}>
                      <p style={{ fontSize: '12px', color: '#666', fontWeight: 600, margin: '0 0 6px 0' }}>Modèle proformat :</p>
                      <img src={customer.proformatPhoto} alt="Proformat" style={{ width: '100%', borderRadius: '6px', height: '100px', objectFit: 'cover' }} />
                    </div>
                  )}

                  <p style={{ fontSize: '13px', color: '#999', margin: '0 0 12px 0' }}>
                    📅 {new Date(customer.purchaseDate).toLocaleDateString('fr-FR')}
                  </p>

                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px',
                    background: customer.called ? '#E0F2F1' : '#f9f9f9',
                    borderRadius: '8px',
                    marginBottom: '12px',
                    cursor: 'pointer'
                  }}
                  onClick={() => toggleCalled(customer.id)}
                  >
                    <input
                      type="checkbox"
                      checked={customer.called}
                      onChange={() => {}}
                      style={{
                        width: '18px',
                        height: '18px',
                        cursor: 'pointer',
                        accentColor: '#00897b'
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: '13px', fontWeight: 500, margin: 0, color: customer.called ? '#00796b' : '#666' }}>
                        {customer.called ? '✓ Appelé(e)' : 'À appeler'}
                      </p>
                    </div>
                  </div>

                  {tab === 'proformats' && customer.called && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px',
                      background: customer.noAnswer ? '#FFEBEE' : '#f9f9f9',
                      borderRadius: '8px',
                      marginBottom: '12px',
                      cursor: 'pointer'
                    }}
                    onClick={() => toggleNoAnswer(customer.id)}
                    >
                      <input
                        type="checkbox"
                        checked={customer.noAnswer}
                        onChange={() => {}}
                        style={{
                          width: '18px',
                          height: '18px',
                          cursor: 'pointer',
                          accentColor: '#d32f2f'
                        }}
                      />
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: '13px', fontWeight: 500, margin: 0, color: customer.noAnswer ? '#c62828' : '#666' }}>
                          {customer.noAnswer ? '✗ Pas de réponse' : 'Pas de réponse'}
                        </p>
                      </div>
                    </div>
                  )}

                  {tab === 'proformats' && customer.noAnswer && (
                    <div style={{ marginBottom: '12px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: '#666', display: 'block', marginBottom: '6px' }}>
                        Message à laisser
                      </label>
                      <textarea
                        value={customer.message}
                        onChange={(e) => updateMessage(customer.id, e.target.value)}
                        placeholder="Ex: Rappelé demain, Laissé message..."
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          border: '1px solid #e0e0e0',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontFamily: 'inherit',
                          resize: 'vertical',
                          minHeight: '50px',
                          outline: 'none',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>
                  )}

                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: '#666', display: 'block', marginBottom: '6px' }}>
                      Observations
                    </label>
                    <textarea
                      value={customer.observations}
                      onChange={(e) => updateObservations(customer.id, e.target.value)}
                      placeholder="Ajouter une note..."
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        border: '1px solid #e0e0e0',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontFamily: 'inherit',
                        resize: 'vertical',
                        minHeight: '60px',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {(tab === 'ancien' || tab === 'proformats') && filteredCustomers && filteredCustomers.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '3rem 2rem',
            color: '#999',
            fontSize: '15px'
          }}>
            <p>Aucun client trouvé</p>
          </div>
        )}
      </div>
    </div>
  );
}
