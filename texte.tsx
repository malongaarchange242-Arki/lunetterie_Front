import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Check, AlertCircle, Package, FileText, Eye, DollarSign, ShoppingCart, Package2, Glasses, BarChart3 } from 'lucide-react';

export default function LunettesManager() {
  const [activeTab, setActiveTab] = useState('tableau');
  const [scannedItems, setScannedItems] = useState([]);
  const [scanInput, setScanInput] = useState('');
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [scanningStarted, setScanningStarted] = useState(false);

  // État pour la réception (scanner QR code)
  const [scannedReception, setScannedReception] = useState([]);
  const [scanInputReception, setScanInputReception] = useState('');
  const [receptionStarted, setReceptionStarted] = useState(false);

  // Données simulées
  const [stats] = useState({
    ca: {
      today: 2165,
      yesterday: 1890,
      lastMonth: 2100,
      lastYear: 2280,
    },
    dayStats: {
      monturesLaboEnAttente: 15,  // Total au labo
      lunettesPaye: 8,  // Paiement reçu AUJOURD'HUI (8 proformas)
      lunettesRemises: 10,  // Remises au client AUJOURD'HUI (finies par labo, payées avant)
      carresLabo: 2,  // Sortis de réserve vers labo
      carresExpires: 2,  // Retour stock (expiration réserve)
      proformasRealises: 12,
      proformasSoldes: 8,  // 8 proformas payées AUJOURD'HUI
      lunettesPresentoir: 24,
    },
    stock: {
      formes: { aviateur: 28, wayfarer: 45, rond: 32, carre: 25 },
      gemmes: { verre: 85, plastique: 45 },
      genres: { homme: 60, femme: 55, unisexe: 15 },
      seuilStock: 20,
    },
  });

  // Tableau détaillé du laboratoire
  const [laboratoireData] = useState([
    { id: 'L001', ref: 'AV-BL-M001', client: 'Jean Dupont', dateEntre: '2024-01-15', statut: 'En attente', correction: '+1.50/-0.75' },
    { id: 'L002', ref: 'WF-RG-F002', client: 'Marie Martin', dateEntre: '2024-01-16', statut: 'Prêt à chercher', correction: '-2.00/-1.25' },
    { id: 'L003', ref: 'RD-OR-M003', client: 'Pierre Dubois', dateEntre: '2024-01-17', statut: 'En attente', correction: '+0.75/-0.50' },
    { id: 'L004', ref: 'CR-BL-F004', client: 'Claire Blanc', dateEntre: '2024-01-18', statut: 'En attente', correction: '-1.50/-2.00' },
    { id: 'L005', ref: 'AV-TI-M005', client: 'Luc Bertrand', dateEntre: '2024-01-18', statut: 'Prêt à chercher', correction: '+2.00/-0.75' },
    { id: 'L006', ref: 'WF-NO-F006', client: 'Sophie Laurent', dateEntre: '2024-01-19', statut: 'Prêt à chercher', correction: '-1.75/-1.50' },
    { id: 'L007', ref: 'RD-AR-M007', client: 'Marc Dubois', dateEntre: '2024-01-19', statut: 'Prêt à chercher', correction: '+1.25/-0.75' },
    { id: 'L008', ref: 'CR-RG-F008', client: 'Isabelle Petit', dateEntre: '2024-01-19', statut: 'Prêt à chercher', correction: '-2.25/-1.75' },
    { id: 'L009', ref: 'AV-NO-M009', client: 'Thomas Henry', dateEntre: '2024-01-19', statut: 'Prêt à chercher', correction: '+0.50/-0.25' },
    { id: 'L010', ref: 'WF-OR-F010', client: 'Valérie Martin', dateEntre: '2024-01-19', statut: 'Prêt à chercher', correction: '-1.00/-0.75' },
    { id: 'L011', ref: 'RD-BL-M011', client: 'Christophe Garcia', dateEntre: '2024-01-20', statut: 'Prêt à chercher', correction: '+1.75/-1.25' },
    { id: 'L012', ref: 'CR-NO-F012', client: 'Nathalie Lefevre', dateEntre: '2024-01-20', statut: 'Prêt à chercher', correction: '-0.75/-0.50' },
    { id: 'L013', ref: 'AV-RG-M013', client: 'Franck Rousseau', dateEntre: '2024-01-20', statut: 'En attente', correction: '+1.50/-0.75' },
    { id: 'L014', ref: 'WF-TI-F014', client: 'Mégane Moreau', dateEntre: '2024-01-20', statut: 'En attente', correction: '-2.00/-1.50' },
    { id: 'L015', ref: 'RD-RG-M015', client: 'Antoine Bernard', dateEntre: '2024-01-20', statut: 'En attente', correction: '+0.75/-0.25' },
  ]);

  // Lunettes payées aujourd'hui (nouveau paiement reçu)
  const [lunettesPayees] = useState([
    { id: 'P001', ref: 'AV-BL-001', client: 'Jean Dupont', datePaiement: '2024-01-21', montant: 280, statut: 'Payée', proformas: 1 },
    { id: 'P002', ref: 'WF-RG-002', client: 'Marie Martin', datePaiement: '2024-01-21', montant: 420, statut: 'Payée', proformas: 2 },
    { id: 'P003', ref: 'RD-OR-003', client: 'Pierre Dubois', datePaiement: '2024-01-21', montant: 235, statut: 'Payée', proformas: 1 },
    { id: 'P004', ref: 'CR-BL-004', client: 'Claire Blanc', datePaiement: '2024-01-21', montant: 195, statut: 'Payée', proformas: 1 },
    { id: 'P005', ref: 'AV-TI-005', client: 'Luc Bertrand', datePaiement: '2024-01-21', montant: 320, statut: 'Payée', proformas: 1 },
    { id: 'P006', ref: 'WF-NO-006', client: 'Sophie Laurent', datePaiement: '2024-01-21', montant: 210, statut: 'Payée', proformas: 1 },
    { id: 'P007', ref: 'RD-AR-007', client: 'Marc Dubois', datePaiement: '2024-01-21', montant: 240, statut: 'Payée', proformas: 1 },
    { id: 'P008', ref: 'CR-RG-008', client: 'Isabelle Petit', datePaiement: '2024-01-21', montant: 265, statut: 'Payée', proformas: 1 },
  ]);

  // Lunettes remises au client aujourd'hui (finies par labo, clients qui avaient déjà payé avant)
  const [lunettesRemises] = useState([
    { id: 'R001', ref: 'AV-BL-001', client: 'Jean Dupont', dateRemise: '2024-01-21', montant: 280, datePaiement: '2024-01-10', statut: 'Remise' },
    { id: 'R002', ref: 'WF-RG-002A', client: 'Marie Martin', dateRemise: '2024-01-21', montant: 210, datePaiement: '2024-01-09', statut: 'Remise' },
    { id: 'R003', ref: 'WF-RG-002B', client: 'Marie Martin', dateRemise: '2024-01-21', montant: 210, datePaiement: '2024-01-09', statut: 'Remise' },
    { id: 'R004', ref: 'RD-OR-003', client: 'Pierre Dubois', dateRemise: '2024-01-21', montant: 235, datePaiement: '2024-01-08', statut: 'Remise' },
    { id: 'R005', ref: 'CR-BL-004', client: 'Claire Blanc', dateRemise: '2024-01-21', montant: 195, datePaiement: '2024-01-12', statut: 'Remise' },
    { id: 'R006', ref: 'AV-TI-005', client: 'Luc Bertrand', dateRemise: '2024-01-21', montant: 320, datePaiement: '2024-01-14', statut: 'Remise' },
    { id: 'R007', ref: 'WF-NO-006', client: 'Sophie Laurent', dateRemise: '2024-01-21', montant: 210, datePaiement: '2024-01-15', statut: 'Remise' },
    { id: 'R008', ref: 'RD-AR-007', client: 'Marc Dubois', dateRemise: '2024-01-21', montant: 240, datePaiement: '2024-01-18', statut: 'Remise' },
    { id: 'R009', ref: 'CR-RG-008', client: 'Isabelle Petit', dateRemise: '2024-01-21', montant: 265, datePaiement: '2024-01-19', statut: 'Remise' },
    { id: 'R010', ref: 'AV-RG-009', client: 'Vincent Martin', dateRemise: '2024-01-21', montant: 245, datePaiement: '2024-01-11', statut: 'Remise' },
  ]);

  // Lunettes en réception (prêtes à être remises au client - avec QR code)
  const [lunettesReception] = useState([
    { id: 'REC001', ref: 'AV-BL-001', client: 'Jean Dupont', qrCode: 'QR-AV-BL-001', statut: 'En attente', datePrete: '2024-01-21' },
    { id: 'REC002', ref: 'WF-RG-002A', client: 'Marie Martin', qrCode: 'QR-WF-RG-002A', statut: 'En attente', datePrete: '2024-01-21' },
    { id: 'REC003', ref: 'WF-RG-002B', client: 'Marie Martin', qrCode: 'QR-WF-RG-002B', statut: 'En attente', datePrete: '2024-01-21' },
    { id: 'REC004', ref: 'RD-OR-003', client: 'Pierre Dubois', qrCode: 'QR-RD-OR-003', statut: 'En attente', datePrete: '2024-01-21' },
    { id: 'REC005', ref: 'CR-BL-004', client: 'Claire Blanc', qrCode: 'QR-CR-BL-004', statut: 'En attente', datePrete: '2024-01-21' },
    { id: 'REC006', ref: 'AV-TI-005', client: 'Luc Bertrand', qrCode: 'QR-AV-TI-005', statut: 'En attente', datePrete: '2024-01-21' },
    { id: 'REC007', ref: 'WF-NO-006', client: 'Sophie Laurent', qrCode: 'QR-WF-NO-006', statut: 'En attente', datePrete: '2024-01-21' },
    { id: 'REC008', ref: 'RD-AR-007', client: 'Marc Dubois', qrCode: 'QR-RD-AR-007', statut: 'En attente', datePrete: '2024-01-21' },
    { id: 'REC009', ref: 'CR-RG-008', client: 'Isabelle Petit', qrCode: 'QR-CR-RG-008', statut: 'En attente', datePrete: '2024-01-21' },
    { id: 'REC010', ref: 'AV-RG-009', client: 'Vincent Martin', qrCode: 'QR-AV-RG-009', statut: 'En attente', datePrete: '2024-01-21' },
  ]);

  // Carrés (paires) sortis de réserve vers labo (client venu payer après)
  const [carresReserveLabo] = useState([
    { id: 'CR001', ref: 'WF-TI-010', client: 'Michel Dupuis', dateSortie: '2024-01-21', dateEntreeReserve: '2024-01-10', jours: 11, correction: '-1.75/-1.50' },
    { id: 'CR002', ref: 'RD-NO-015', client: 'Valérie Rousseau', dateSortie: '2024-01-21', dateEntreeReserve: '2024-01-08', jours: 13, correction: '+0.50/-0.75' },
  ]);

  // Carrés retournés au stock local (plus de 10 jours en réserve)
  const [carresReserveExpires] = useState([
    { id: 'EXP001', ref: 'AV-RG-020', dateEntreeReserve: '2024-01-09', dateRetour: '2024-01-21', joursReserve: 12, raison: 'Client ne s\'est pas présenté' },
    { id: 'EXP002', ref: 'CR-OR-025', dateEntreeReserve: '2024-01-08', dateRetour: '2024-01-21', joursReserve: 13, raison: 'Dépassement délai réserve' },
  ]);

  // État actuel de la réserve
  const [reserveActuelle] = useState([
    { id: 'RES001', ref: 'WF-BL-030', client: 'Vincent Martin', dateEntree: '2024-01-20', jours: 1 },
    { id: 'RES002', ref: 'RD-RG-035', client: 'Nathalie Petitjean', dateEntree: '2024-01-19', jours: 2 },
    { id: 'RES003', ref: 'CR-TI-040', client: 'Frédéric Leclerc', dateEntree: '2024-01-17', jours: 4 },
    { id: 'RES004', ref: 'AV-NO-045', client: 'Caroline Renault', dateEntree: '2024-01-15', jours: 6 },
    { id: 'RES005', ref: 'WF-RG-050', client: 'Dominique Fabre', dateEntree: '2024-01-12', jours: 9 },
  ]);

  const [inventoryList] = useState([
    { id: 'M001', ref: 'AV-BL-001', forme: 'Aviateur', couleur: 'Noir', zone: 'A1' },
    { id: 'M002', ref: 'WF-RG-002', forme: 'Wayfarer', couleur: 'Rouge', zone: 'B2' },
    { id: 'M003', ref: 'RD-OR-003', forme: 'Rond', couleur: 'Or', zone: 'A3' },
    { id: 'M004', ref: 'CR-BL-004', forme: 'Carré', couleur: 'Bleu', zone: 'C1' },
    { id: 'M005', ref: 'AV-TI-005', forme: 'Aviateur', couleur: 'Titane', zone: 'B3' },
  ]);

  const handleScan = () => {
    const item = inventoryList.find(i => i.id === scanInput || i.ref === scanInput);
    if (item && !scannedItems.find(s => s.id === item.id)) {
      setScannedItems([...scannedItems, { ...item, scanned: true }]);
      setScanInput('');
    }
  };

  const getTrendColor = (current, previous) => {
    return current > previous ? '#10b981' : current < previous ? '#ef4444' : '#6b7280';
  };

  const getTrendIcon = (current, previous) => {
    return current > previous ? <TrendingUp size={16} /> : <TrendingDown size={16} />;
  };

  const percentageChange = (current, previous) => {
    return (((current - previous) / previous) * 100).toFixed(1);
  };

  const formData = stats.stock.formes;
  const totalFormes = Object.values(formData).reduce((a, b) => a + b, 0);

  const gemmeData = stats.stock.gemmes;
  const totalGemmes = Object.values(gemmeData).reduce((a, b) => a + b, 0);

  const genreData = stats.stock.genres;
  const totalGenres = Object.values(genreData).reduce((a, b) => a + b, 0);

  const tabs = [
    { id: 'tableau', label: 'Tableau de bord', icon: '📊' },
    { id: 'ventes', label: 'Ventes', icon: '💰' },
    { id: 'reception', label: 'Réception', icon: '📋' },
    { id: 'scanner', label: 'Scanner', icon: '🔍' },
    { id: 'stock', label: 'Stock', icon: '📦' },
  ];

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
      color: 'var(--text-primary)',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {/* Header Premium */}
      <div style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        padding: '2rem',
        boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <div style={{ fontSize: '32px' }}>👓</div>
            <div>
              <h1 style={{ fontSize: '28px', fontWeight: '700', margin: '0' }}>LunettePro</h1>
              <p style={{ fontSize: '13px', opacity: 0.9, margin: '0.25rem 0 0' }}>Gestion complète du magasin</p>
            </div>
          </div>
          <p style={{ fontSize: '14px', opacity: 0.95, margin: '0' }}>
            {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* Navigation Onglets Premium */}
      <div style={{
        background: 'white',
        borderBottom: '2px solid #e5e7eb',
        padding: '0 2rem',
        maxWidth: '1400px',
        margin: '0 auto',
        display: 'flex',
        gap: '0.5rem',
        overflowX: 'auto',
      }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '1.25rem 1.5rem',
              border: 'none',
              background: activeTab === tab.id ? 'transparent' : 'transparent',
              borderBottom: activeTab === tab.id ? '3px solid #667eea' : '3px solid transparent',
              color: activeTab === tab.id ? '#667eea' : '#9ca3af',
              cursor: 'pointer',
              fontSize: '15px',
              fontWeight: activeTab === tab.id ? '600' : '500',
              transition: 'all 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              whiteSpace: 'nowrap',
            }}
            onMouseOver={(e) => {
              if (activeTab !== tab.id) {
                e.target.style.color = '#667eea';
              }
            }}
            onMouseOut={(e) => {
              if (activeTab !== tab.id) {
                e.target.style.color = '#9ca3af';
              }
            }}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Contenu */}
      <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
        
        {/* TABLEAU DE BORD GÉNÉRAL */}
        {activeTab === 'tableau' && (
          <div>
            {/* CA Principal - Grosse Card */}
            <div 
              onClick={() => setSelectedDetail({
                title: 'Chiffre d\'affaires',
                subtitle: `Analyse complète du ${new Date().toLocaleDateString('fr-FR')}`,
                icon: '💵',
                color: '#667eea',
                colorEnd: '#764ba2',
                stats: [
                  { label: 'Aujourd\'hui', value: stats.ca.today + ' FCFA' },
                  { label: 'Hier', value: stats.ca.yesterday + ' FCFA' },
                  { label: 'Mois dernier', value: stats.ca.lastMonth + ' FCFA' },
                  { label: 'Année dernière', value: stats.ca.lastYear + ' FCFA' }
                ],
                details: [
                  { name: 'Performance vs hier', meta: `${stats.ca.today > stats.ca.yesterday ? 'Hausse' : 'Baisse'} de ${percentageChange(stats.ca.today, stats.ca.yesterday)}%`, badge: { text: stats.ca.today > stats.ca.yesterday ? '📈' : '📉', bg: stats.ca.today > stats.ca.yesterday ? '#dcfce7' : '#fee2e2', color: stats.ca.today > stats.ca.yesterday ? '#16a34a' : '#dc2626' } },
                  { name: 'Performance vs mois dernier', meta: `${stats.ca.today > stats.ca.lastMonth ? 'Hausse' : 'Baisse'} de ${percentageChange(stats.ca.today, stats.ca.lastMonth)}%`, badge: { text: stats.ca.today > stats.ca.lastMonth ? '📈' : '📉', bg: stats.ca.today > stats.ca.lastMonth ? '#dcfce7' : '#fee2e2', color: stats.ca.today > stats.ca.lastMonth ? '#16a34a' : '#dc2626' } },
                  { name: 'Performance vs année dernière', meta: `${stats.ca.today > stats.ca.lastYear ? 'Hausse' : 'Baisse'} de ${percentageChange(stats.ca.today, stats.ca.lastYear)}%`, badge: { text: stats.ca.today > stats.ca.lastYear ? '📈' : '📉', bg: stats.ca.today > stats.ca.lastYear ? '#dcfce7' : '#fee2e2', color: stats.ca.today > stats.ca.lastYear ? '#16a34a' : '#dc2626' } },
                ],
                description: 'Les comparaisons montrent la tendance de vos ventes. Une croissance positive indique une bonne performance commerciale.'
              })}
              style={{
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                borderRadius: '12px',
                padding: '2rem',
                marginBottom: '2rem',
                boxShadow: '0 10px 30px rgba(102, 126, 234, 0.3)',
                cursor: 'pointer',
                transition: 'all 0.3s',
              }}
              onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
              onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '2rem' }}>
                <div>
                  <p style={{ fontSize: '13px', opacity: 0.9, margin: '0 0 0.5rem' }}>Chiffre d'affaires aujourd'hui</p>
                  <h2 style={{ fontSize: '48px', fontWeight: '700', margin: '0' }}>{stats.ca.today.toLocaleString('fr-FR')} FCFA</h2>
                </div>
                <div style={{ borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: '2rem' }}>
                  <p style={{ fontSize: '12px', opacity: 0.85, margin: '0 0 0.75rem' }}>Hier</p>
                  <p style={{ fontSize: '24px', fontWeight: '600', margin: '0 0 0.5rem' }}>{stats.ca.yesterday} FCFA</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '13px' }}>
                    {getTrendIcon(stats.ca.today, stats.ca.yesterday)}
                    <span>{percentageChange(stats.ca.today, stats.ca.yesterday)}%</span>
                  </div>
                </div>
                <div style={{ borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: '2rem' }}>
                  <p style={{ fontSize: '12px', opacity: 0.85, margin: '0 0 0.75rem' }}>Mois dernier</p>
                  <p style={{ fontSize: '24px', fontWeight: '600', margin: '0 0 0.5rem' }}>{stats.ca.lastMonth} FCFA</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '13px' }}>
                    {getTrendIcon(stats.ca.today, stats.ca.lastMonth)}
                    <span>{percentageChange(stats.ca.today, stats.ca.lastMonth)}%</span>
                  </div>
                </div>
                <div style={{ borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: '2rem' }}>
                  <p style={{ fontSize: '12px', opacity: 0.85, margin: '0 0 0.75rem' }}>Année dernière</p>
                  <p style={{ fontSize: '24px', fontWeight: '600', margin: '0 0 0.5rem' }}>{stats.ca.lastYear} FCFA</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '13px' }}>
                    {getTrendIcon(stats.ca.today, stats.ca.lastYear)}
                    <span>{percentageChange(stats.ca.today, stats.ca.lastYear)}%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Grille de statistiques */}
            <h3 style={{ fontSize: '18px', fontWeight: '600', margin: '2rem 0 1.5rem', color: '#1f2937' }}>Résumé du jour</h3>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '1.5rem',
              marginBottom: '2rem',
            }}>
              {[
                { 
                  label: 'Montures au laboratoire', 
                  value: stats.dayStats.monturesLaboEnAttente, 
                  color: '#667eea', 
                  colorEnd: '#764ba2',
                  icon: Package,
                  desc: 'Total en attente ou prêtes',
                  details: [
                    { name: 'En attente de travail', meta: 'Pas encore traitées', badge: { text: '5', bg: '#dbeafe', color: '#0284c7' } },
                    { name: 'Prêtes à chercher', meta: 'Travail terminé', badge: { text: '10', bg: '#dcfce7', color: '#16a34a' } },
                  ],
                  description: 'Toutes les montures qui sont actuellement au laboratoire, peu importe depuis combien de temps. Certaines sont en attente de traitement, d\'autres sont prêtes à être remises aux clients.'
                },
                { 
                  label: 'Lunettes payées aujourd\'hui', 
                  value: lunettesPayees.length,
                  color: '#3b82f6',
                  colorEnd: '#1d4ed8',
                  icon: DollarSign,
                  desc: 'Paiement reçu aujourd\'hui',
                  details: [
                    { name: 'Proforma validés', meta: 'Clients confirmés', badge: { text: lunettesPayees.length.toString(), bg: '#dbeafe', color: '#0284c7' } },
                  ],
                  description: 'Clients qui ont validé leur proforma ET effectué le paiement AUJOURD\'HUI. Une proforma peut contenir plusieurs lunettes.',
                  showTableauPayees: true,
                },
                { 
                  label: 'Lunettes remises au client', 
                  value: lunettesRemises.length,
                  color: '#10b981',
                  colorEnd: '#059669',
                  icon: ShoppingCart,
                  desc: 'Finies par labo (payées avant)',
                  details: [
                    { name: 'Sorties du magasin', meta: 'Labo terminé', badge: { text: lunettesRemises.length.toString(), bg: '#dcfce7', color: '#16a34a' } },
                  ],
                  description: 'Lunettes que le labo a terminé de monter et remises au client AUJOURD\'HUI. Ces clients avaient déjà payé AVANT. C\'est la sortie du stock du magasin.',
                  showTableauRemises: true,
                },
                { 
                  label: 'Proformas réalisés', 
                  value: stats.dayStats.proformasRealises, 
                  color: '#f59e0b',
                  colorEnd: '#d97706',
                  icon: FileText,
                  details: [
                    { name: 'Proformas validés', meta: 'Client confirmé', badge: { text: '8', bg: '#dcfce7', color: '#16a34a' } },
                    { name: 'Proformas en attente', meta: 'Signature client', badge: { text: '4', bg: '#fed7aa', color: '#92400e' } },
                  ]
                },
                { 
                  label: 'Lunettes présentoir', 
                  value: stats.dayStats.lunettesPresentoir, 
                  color: '#6366f1',
                  colorEnd: '#4f46e5',
                  icon: Eye,
                  details: [
                    { name: 'Disponibles à la vente', meta: 'Prêtes pour clients', badge: { text: '24', bg: '#e0e7ff', color: '#4338ca' } },
                  ]
                },
                { 
                  label: 'Proformas soldés', 
                  value: stats.dayStats.proformasSoldes, 
                  color: '#ef4444',
                  colorEnd: '#dc2626',
                  icon: DollarSign,
                  details: [
                    { name: 'Montant total', meta: 'Proformas finalisées', badge: { text: '2.165 FCFA', bg: '#fee2e2', color: '#dc2626' } },
                  ]
                },
                { 
                  label: 'Carrés: Réserve → Labo', 
                  value: stats.dayStats.carresLabo, 
                  color: '#8b5cf6',
                  colorEnd: '#7c3aed',
                  icon: Package,
                  desc: 'Client venu payer après',
                  details: [
                    { name: 'Sortis de réserve', meta: 'Envoyés au labo', badge: { text: '2', bg: '#f3e8ff', color: '#7c3aed' } },
                  ],
                  description: 'Paires retirées de la réserve pour retourner au labo car le client est venu payer après quelques jours de réserve.',
                  showTableauCarresLabo: true,
                },
                { 
                  label: 'Carrés: Réserve → Stock', 
                  value: stats.dayStats.carresExpires, 
                  color: '#f97316',
                  colorEnd: '#ea580c',
                  icon: AlertCircle,
                  desc: 'Dépassement délai (>10j)',
                  details: [
                    { name: 'Retournés au stock', meta: 'Client non présenté', badge: { text: '2', bg: '#fed7aa', color: '#9a3412' } },
                  ],
                  description: '⚠️ Paires en réserve depuis plus de 10 jours. Elles retournent automatiquement au stock local. Le client perd son option de réserve.',
                  showTableauCarresExpires: true,
                },
              ].map((stat, idx) => (
                <div
                  key={idx}
                  style={{
                    background: 'white',
                    borderRadius: '12px',
                    padding: '1.5rem',
                    boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
                    border: '1px solid #f3f4f6',
                    transition: 'all 0.3s ease',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    if (stat.label === 'Montures au laboratoire') {
                      setSelectedDetail({
                        title: stat.label,
                        subtitle: stat.desc || `Détails du ${new Date().toLocaleDateString('fr-FR')}`,
                        icon: '🔧',
                        color: stat.color,
                        colorEnd: stat.colorEnd,
                        value: stat.value,
                        stats: [
                          { label: 'Total au labo', value: stat.value }
                        ],
                        details: stat.details,
                        showTableau: true,
                      });
                    } else {
                      setSelectedDetail({
                        title: stat.label,
                        subtitle: stat.desc || `Détails du ${new Date().toLocaleDateString('fr-FR')}`,
                        icon: '📊',
                        color: stat.color,
                        colorEnd: stat.colorEnd,
                        value: stat.value,
                        stats: [
                          { label: stat.label, value: stat.value }
                        ],
                        details: stat.details,
                      });
                    }
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.boxShadow = '0 12px 25px rgba(0,0,0,0.12)';
                    e.currentTarget.style.transform = 'translateY(-4px)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.08)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div>
                      <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 0.75rem' }}>{stat.label}</p>
                      <p style={{ fontSize: '36px', fontWeight: '700', margin: '0', color: stat.color }}>{stat.value}</p>
                      {stat.desc && <p style={{ fontSize: '11px', color: '#9ca3af', margin: '0.5rem 0 0' }}>{stat.desc}</p>}
                    </div>
                    <div style={{
                      width: '50px',
                      height: '50px',
                      background: stat.color + '15',
                      borderRadius: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      <stat.icon size={24} color={stat.color} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Analyse Stock */}
            <h3 style={{ fontSize: '18px', fontWeight: '600', margin: '2rem 0 1.5rem', color: '#1f2937' }}>État du stock</h3>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '1.5rem',
            }}>
              {/* Formes */}
              <div style={{
                background: 'white',
                borderRadius: '12px',
                padding: '1.5rem',
                boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
                border: '1px solid #f3f4f6',
              }}>
                <h4 style={{ fontSize: '14px', fontWeight: '600', margin: '0 0 1.5rem', color: '#1f2937' }}>Distribution des formes</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {Object.entries(formData).map(([forme, count]) => {
                    const percent = ((count / totalFormes) * 100).toFixed(0);
                    return (
                      <div key={forme}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                          <span style={{ fontSize: '13px', fontWeight: '500', textTransform: 'capitalize' }}>{forme}</span>
                          <span style={{ fontSize: '13px', fontWeight: '600', color: '#667eea' }}>{percent}%</span>
                        </div>
                        <div style={{
                          height: '8px',
                          background: '#e5e7eb',
                          borderRadius: '4px',
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            height: '100%',
                            background: 'linear-gradient(90deg, #667eea, #764ba2)',
                            width: `${percent}%`,
                            transition: 'width 0.3s',
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Gemmes */}
              <div style={{
                background: 'white',
                borderRadius: '12px',
                padding: '1.5rem',
                boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
                border: '1px solid #f3f4f6',
              }}>
                <h4 style={{ fontSize: '14px', fontWeight: '600', margin: '0 0 1.5rem', color: '#1f2937' }}>Ventes par monture</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {[
                    { forme: 'Wayfarer', count: 4, percent: 40 },
                    { forme: 'Aviateur', count: 3, percent: 30 },
                    { forme: 'Rond', count: 2, percent: 20 },
                    { forme: 'Carré', count: 1, percent: 10 },
                  ].map((item, idx) => (
                    <div key={idx}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '13px', fontWeight: '500' }}>{item.forme}</span>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: '#0891b2' }}>{item.percent}%</span>
                      </div>
                      <div style={{
                        height: '8px',
                        background: '#e5e7eb',
                        borderRadius: '4px',
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          height: '100%',
                          background: item.count === 1 ? 'linear-gradient(90deg, #f59e0b, #ea580c)' : 'linear-gradient(90deg, #06b6d4, #0891b2)',
                          width: `${item.percent}%`,
                          transition: 'width 0.3s',
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Genres */}
              <div style={{
                background: 'white',
                borderRadius: '12px',
                padding: '1.5rem',
                boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
                border: '1px solid #f3f4f6',
              }}>
                <h4 style={{ fontSize: '14px', fontWeight: '600', margin: '0 0 1.5rem', color: '#1f2937' }}>Distribution par genre</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {Object.entries(genreData).map(([genre, count]) => {
                    const percent = ((count / totalGenres) * 100).toFixed(0);
                    return (
                      <div key={genre}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                          <span style={{ fontSize: '13px', fontWeight: '500', textTransform: 'capitalize' }}>{genre}</span>
                          <span style={{ fontSize: '13px', fontWeight: '600', color: '#f59e0b' }}>{percent}%</span>
                        </div>
                        <div style={{
                          height: '8px',
                          background: '#e5e7eb',
                          borderRadius: '4px',
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            height: '100%',
                            background: 'linear-gradient(90deg, #f59e0b, #d97706)',
                            width: `${percent}%`,
                            transition: 'width 0.3s',
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VENTES */}
        {activeTab === 'ventes' && (
          <div>
            <h2 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 2rem', color: '#1f2937' }}>Analyse des ventes</h2>
            
            <div style={{
              background: 'white',
              borderRadius: '12px',
              padding: '2rem',
              boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
              border: '1px solid #f3f4f6',
              marginBottom: '2rem',
            }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', margin: '0 0 1.5rem', color: '#1f2937' }}>Performance mensuelle</h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '2rem' }}>
                <div 
                  onClick={() => setSelectedDetail({
                    title: 'Total semaine',
                    subtitle: 'Chiffre d\'affaires 7 jours',
                    icon: '💰',
                    color: '#667eea',
                    colorEnd: '#764ba2',
                    stats: [
                      { label: 'Total', value: '12.450 FCFA' },
                      { label: 'Variation', value: '+18%' }
                    ],
                    details: [
                      { name: 'Lunettes vendues', meta: 'Paires complètes', badge: { text: '35', bg: '#dbeafe', color: '#0284c7' } },
                      { name: 'Ventes accessoires', meta: 'Étuis, nettoyants', badge: { text: '18', bg: '#dcfce7', color: '#16a34a' } },
                      { name: 'Reparations', meta: 'Ajustements', badge: { text: '8', bg: '#fed7aa', color: '#d97706' } },
                    ],
                    description: 'Performance en hausse comparée à la semaine précédente. Tendance positive pour les ventes accessoires.'
                  })}
                  style={{ cursor: 'pointer', padding: '1rem', borderRadius: '10px', transition: 'all 0.3s', backgroundColor: '#f9fafb' }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f9fafb'}
                >
                  <p style={{ fontSize: '12px', color: '#9ca3af', margin: '0 0 0.75rem', fontWeight: '500' }}>Total semaine</p>
                  <p style={{ fontSize: '32px', fontWeight: '700', color: '#667eea', margin: '0' }}>12.450FCFA</p>
                  <p style={{ fontSize: '12px', color: '#10b981', margin: '0.5rem 0 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <TrendingUp size={14} /> +18% vs semaine dernier
                  </p>
                </div>
                <div 
                  onClick={() => setSelectedDetail({
                    title: 'Ticket moyen',
                    subtitle: 'Montant moyen par transaction',
                    icon: '🎟️',
                    color: '#10b981',
                    colorEnd: '#059669',
                    stats: [
                      { label: 'Ticket moyen', value: '204 FCFA' },
                      { label: 'Variation', value: '-5%' }
                    ],
                    details: [
                      { name: 'Lunettes seules', meta: 'Moyenne', badge: { text: '185 FCFA', bg: '#dcfce7', color: '#16a34a' } },
                      { name: 'Avec accessoires', meta: 'Moyenne', badge: { text: '245 FCFA', bg: '#dcfce7', color: '#16a34a' } },
                      { name: 'Plus cher panier', meta: 'Record du jour', badge: { text: '580 FCFA', bg: '#fef3c7', color: '#d97706' } },
                    ],
                    description: 'La baisse du ticket moyen est due à une augmentation des ventes de lunettes seules sans accessoires.'
                  })}
                  style={{ cursor: 'pointer', padding: '1rem', borderRadius: '10px', transition: 'all 0.3s', backgroundColor: '#f9fafb' }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f9fafb'}
                >
                  <p style={{ fontSize: '12px', color: '#9ca3af', margin: '0 0 0.75rem', fontWeight: '500' }}>Ticket moyen</p>
                  <p style={{ fontSize: '32px', fontWeight: '700', color: '#10b981', margin: '0' }}>204FCFA</p>
                  <p style={{ fontSize: '12px', color: '#ef4444', margin: '0.5rem 0 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <TrendingDown size={14} /> -5% vs moyenne
                  </p>
                </div>
                <div 
                  onClick={() => setSelectedDetail({
                    title: 'Nombre de transactions',
                    subtitle: 'Transactions du jour',
                    icon: '📈',
                    color: '#f59e0b',
                    colorEnd: '#d97706',
                    stats: [
                      { label: 'Transactions', value: '61' },
                      { label: 'Variation', value: '+12%' }
                    ],
                    details: [
                      { name: 'Ventes complétées', meta: 'Paiement reçu', badge: { text: '56', bg: '#dcfce7', color: '#16a34a' } },
                      { name: 'En attente', meta: 'Pas encore payée', badge: { text: '5', bg: '#fed7aa', color: '#d97706' } },
                      { name: 'Heure de pointe', meta: 'Entre 12h-14h', badge: { text: '22', bg: '#fef3c7', color: '#d97706' } },
                    ]
                  })}
                  style={{ cursor: 'pointer', padding: '1rem', borderRadius: '10px', transition: 'all 0.3s', backgroundColor: '#f9fafb' }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f9fafb'}
                >
                  <p style={{ fontSize: '12px', color: '#9ca3af', margin: '0 0 0.75rem', fontWeight: '500' }}>Nb transactions</p>
                  <p style={{ fontSize: '32px', fontWeight: '700', color: '#f59e0b', margin: '0' }}>61</p>
                  <p style={{ fontSize: '12px', color: '#10b981', margin: '0.5rem 0 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <TrendingUp size={14} /> +12% vs semaine
                  </p>
                </div>
              </div>
            </div>

            {/* Tableau détaillé */}
            <div style={{
              background: 'white',
              borderRadius: '12px',
              padding: '2rem',
              boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
              border: '1px solid #f3f4f6',
              overflowX: 'auto',
            }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', margin: '0 0 1.5rem', color: '#1f2937' }}>Dernières transactions</h3>
              
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ textAlign: 'left', padding: '1rem 0', fontWeight: '600', color: '#6b7280' }}>Client</th>
                    <th style={{ textAlign: 'left', padding: '1rem 1rem', fontWeight: '600', color: '#6b7280' }}>Monture</th>
                    <th style={{ textAlign: 'left', padding: '1rem 1rem', fontWeight: '600', color: '#6b7280' }}>Montant</th>
                    <th style={{ textAlign: 'left', padding: '1rem 1rem', fontWeight: '600', color: '#6b7280' }}>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: 'Jean Dupont', frame: 'Aviateur Noir', amount: '280 FCFA', status: 'Payée' },
                    { name: 'Marie Martin', frame: 'Wayfarer Rouge', amount: '210 FCFA', status: 'En attente' },
                    { name: 'Pierre Dubois', frame: 'Rond Or', amount: '235 FCFA', status: 'Payée' },
                    { name: 'Claire Blanc', frame: 'Carré Bleu', amount: '195 FCFA', status: 'Payée' },
                    { name: 'Luc Bertrand', frame: 'Aviateur Titane', amount: '320 FCFA', status: 'En attente' },
                  ].map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '1rem 0' }}>{row.name}</td>
                      <td style={{ padding: '1rem 1rem', color: '#6b7280' }}>{row.frame}</td>
                      <td style={{ padding: '1rem 1rem', fontWeight: '600', color: '#667eea' }}>{row.amount}</td>
                      <td style={{ padding: '1rem 1rem' }}>
                        <span style={{
                          padding: '0.4rem 0.8rem',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: '600',
                          background: row.status === 'Payée' ? '#d1fae5' : '#fed7aa',
                          color: row.status === 'Payée' ? '#065f46' : '#92400e',
                        }}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* RÉCEPTION - SCANNER QR CODE */}
        {activeTab === 'reception' && (
          <div>
            <div style={{
              background: 'white',
              borderRadius: '12px',
              padding: '2rem',
              boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
              border: '1px solid #f3f4f6',
              marginBottom: '2rem',
            }}>
              <h3 style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 0.5rem', color: '#1f2937' }}>
                📋 Réception - Remettre au client
              </h3>
              <p style={{ color: '#6b7280', margin: '0 0 2rem', fontSize: '14px' }}>
                Scannez le QR code ou entrez la référence pour confirmer la remise
              </p>

              {/* Champ de saisie + QR code */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 150px',
                gap: '1.5rem',
                marginBottom: '2rem',
                padding: '1.5rem',
                background: '#f9fafb',
                borderRadius: '12px',
                border: '2px solid #0891b2',
              }}>
                {/* Colonne gauche : Champ de saisie */}
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#6b7280', marginBottom: '0.5rem' }}>
                    Référence ou scan QR code :
                  </label>
                  <input
                    type="text"
                    value={scanInputReception}
                    onChange={(e) => {
                      const value = e.target.value;
                      setScanInputReception(value);
                      
                      // Auto-validation si l'utilisateur entre une ref
                      if (value.length > 0) {
                        const item = lunettesReception.find(l => l.ref === value.toUpperCase() || l.qrCode === value);
                        if (item && !scannedReception.find(s => s.id === item.id)) {
                          setScannedReception([...scannedReception, item]);
                          setScanInputReception('');
                        }
                      }
                    }}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        const item = lunettesReception.find(l => l.ref === scanInputReception.toUpperCase() || l.qrCode === scanInputReception);
                        if (item && !scannedReception.find(s => s.id === item.id)) {
                          setScannedReception([...scannedReception, item]);
                          setScanInputReception('');
                        }
                      }
                    }}
                    placeholder="Ex: AV-BL-001 ou scanner..."
                    autoFocus
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontFamily: 'system-ui',
                      fontWeight: '500',
                    }}
                  />
                </div>

                {/* Colonne droite : QR code */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                }}>
                  <div style={{
                    width: '140px',
                    height: '140px',
                    background: 'white',
                    border: '2px solid #0891b2',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}>
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(scanInputReception || 'PRÊT')}`}
                      alt="QR Code"
                      style={{ width: '100%', height: '100%' }}
                    />
                  </div>
                  <p style={{ fontSize: '11px', color: '#6b7280', margin: '0', textAlign: 'center' }}>
                    Scannez →
                  </p>
                </div>
              </div>

              {/* Statistiques */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: '1rem',
                marginBottom: '2rem',
                padding: '1rem',
                background: '#eff6ff',
                borderRadius: '10px',
                border: '1px solid #bfdbfe',
              }}>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ color: '#6b7280', fontSize: '12px', margin: '0 0 0.5rem', fontWeight: '600' }}>À remettre</p>
                  <p style={{ color: '#0891b2', fontSize: '22px', fontWeight: '700', margin: '0' }}>
                    {lunettesReception.length}
                  </p>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ color: '#6b7280', fontSize: '12px', margin: '0 0 0.5rem', fontWeight: '600' }}>Scannées</p>
                  <p style={{ color: '#16a34a', fontSize: '22px', fontWeight: '700', margin: '0' }}>
                    {scannedReception.length}
                  </p>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ color: '#6b7280', fontSize: '12px', margin: '0 0 0.5rem', fontWeight: '600' }}>Reste</p>
                  <p style={{ color: '#f59e0b', fontSize: '22px', fontWeight: '700', margin: '0' }}>
                    {lunettesReception.length - scannedReception.length}
                  </p>
                </div>
              </div>

              {/* Barre de progression */}
              <div style={{
                height: '10px',
                background: '#e5e7eb',
                borderRadius: '5px',
                overflow: 'hidden',
                marginBottom: '2rem',
              }}>
                <div style={{
                  height: '100%',
                  background: 'linear-gradient(90deg, #16a34a, #22c55e)',
                  width: `${lunettesReception.length > 0 ? (scannedReception.length / lunettesReception.length) * 100 : 0}%`,
                  transition: 'width 0.3s',
                }} />
              </div>
            </div>

            {/* Liste COMPLETE des lunettes à remettre (style présentoir) */}
            <div style={{
              background: 'white',
              borderRadius: '12px',
              boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
              border: '1px solid #f3f4f6',
              overflow: 'hidden',
              marginBottom: '2rem',
            }}>
              <div style={{
                padding: '1.5rem',
                borderBottom: '1px solid #e5e7eb',
                background: '#f9fafb',
              }}>
                <h4 style={{ margin: '0', fontSize: '15px', fontWeight: '600', color: '#1f2937' }}>
                  📦 Lunettes prêtes à remettre ({scannedReception.length}/{lunettesReception.length})
                </h4>
              </div>

              <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                {lunettesReception.map((item, idx) => {
                  const isScanned = scannedReception.find(s => s.id === item.id);
                  return (
                    <div
                      key={item.id}
                      style={{
                        padding: '1.2rem 1.5rem',
                        borderBottom: idx !== lunettesReception.length - 1 ? '1px solid #e5e7eb' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem',
                        background: isScanned ? '#f0fdf4' : 'white',
                        transition: 'all 0.3s',
                      }}
                    >
                      {/* QR code mini */}
                      <div style={{
                        width: '50px',
                        height: '50px',
                        background: isScanned ? '#dcfce7' : '#fef3c7',
                        borderRadius: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        border: `2px solid ${isScanned ? '#16a34a' : '#f59e0b'}`,
                        overflow: 'hidden',
                      }}>
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=45x45&data=${encodeURIComponent(item.qrCode)}`}
                          alt="QR"
                          style={{ width: '100%', height: '100%', borderRadius: '8px' }}
                        />
                      </div>

                      {/* Info lunette */}
                      <div style={{ flex: 1 }}>
                        <p style={{ fontWeight: '600', margin: '0 0 0.25rem', color: '#1f2937', fontSize: '14px' }}>
                          {item.ref}
                        </p>
                        <p style={{ fontSize: '12px', color: '#6b7280', margin: '0' }}>
                          {item.client}
                        </p>
                        <p style={{ fontSize: '11px', color: '#0891b2', margin: '0.25rem 0 0', fontFamily: 'monospace', fontWeight: '500' }}>
                          {item.qrCode}
                        </p>
                      </div>

                      {/* Badge statut */}
                      <div style={{
                        padding: '0.5rem 1rem',
                        background: isScanned ? '#dcfce7' : '#fed7aa',
                        borderRadius: '8px',
                        fontWeight: '600',
                        fontSize: '13px',
                        color: isScanned ? '#16a34a' : '#9a3412',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        flexShrink: 0,
                      }}>
                        {isScanned ? '✓ Remis' : '⏳ En attente'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{
              background: 'white',
              borderRadius: '12px',
              boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
              border: '1px solid #f3f4f6',
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '1.5rem',
                borderBottom: '1px solid #e5e7eb',
                background: '#f9fafb',
              }}>
                <h4 style={{ margin: '0', fontSize: '15px', fontWeight: '600', color: '#1f2937' }}>
                  ✓ Lunettes remises ({scannedReception.length}/{lunettesReception.length})
                </h4>
              </div>

              <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                {scannedReception.length === 0 ? (
                  <div style={{
                    padding: '3rem 2rem',
                    textAlign: 'center',
                    color: '#9ca3af',
                  }}>
                    <p style={{ fontSize: '14px', margin: '0' }}>Aucune lunette scannée pour l'instant</p>
                  </div>
                ) : (
                  scannedReception.map((item, idx) => {
                    const lunetteData = lunettesReception.find(l => l.id === item.id);
                    return (
                      <div
                        key={item.id}
                        style={{
                          padding: '1.2rem 1.5rem',
                          borderBottom: idx !== scannedReception.length - 1 ? '1px solid #e5e7eb' : 'none',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '1rem',
                          background: idx % 2 === 0 ? '#ffffff' : '#f9fafb',
                          animation: 'slideUp 0.3s ease',
                        }}
                      >
                        {/* QR code mini */}
                        <div style={{
                          width: '50px',
                          height: '50px',
                          background: '#dcfce7',
                          borderRadius: '10px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          border: '2px solid #16a34a',
                        }}>
                          <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=45x45&data=${encodeURIComponent(item.qrCode)}`}
                            alt="QR"
                            style={{ width: '100%', height: '100%', borderRadius: '8px' }}
                          />
                        </div>

                        {/* Info monture */}
                        <div style={{ flex: 1 }}>
                          <p style={{ fontWeight: '600', margin: '0 0 0.25rem', color: '#1f2937', fontSize: '14px' }}>
                            {item.ref}
                          </p>
                          <p style={{ fontSize: '12px', color: '#6b7280', margin: '0' }}>
                            {item.client}
                          </p>
                          <p style={{ fontSize: '11px', color: '#0891b2', margin: '0.25rem 0 0', fontFamily: 'monospace', fontWeight: '500' }}>
                            {item.qrCode}
                          </p>
                        </div>

                        {/* Badge remis */}
                        <div style={{
                          padding: '0.5rem 1rem',
                          background: '#dcfce7',
                          borderRadius: '8px',
                          fontWeight: '600',
                          fontSize: '13px',
                          color: '#16a34a',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                        }}>
                          ✓ Remis
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Bouton réinitialiser si tous scannés */}
            {scannedReception.length === lunettesReception.length && scannedReception.length > 0 && (
              <div style={{
                marginTop: '2rem',
                display: 'flex',
                gap: '1rem',
              }}>
                <button
                  onClick={() => {
                    setScannedReception([]);
                    setScanInputReception('');
                  }}
                  style={{
                    flex: 1,
                    padding: '1rem',
                    background: 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '10px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    fontSize: '15px',
                    transition: 'all 0.3s',
                  }}
                  onMouseOver={(e) => {
                    e.target.style.transform = 'translateY(-2px)';
                    e.target.style.boxShadow = '0 10px 20px rgba(34,197,94,0.3)';
                  }}
                  onMouseOut={(e) => {
                    e.target.style.transform = 'translateY(0)';
                    e.target.style.boxShadow = 'none';
                  }}
                >
                  🎉 Réception terminée - Nouvelle session
                </button>
              </div>
            )}

            <style>{`
              @keyframes slideUp {
                from {
                  transform: translateY(10px);
                  opacity: 0;
                }
                to {
                  transform: translateY(0);
                  opacity: 1;
                }
              }
            `}</style>
          </div>
        )}

        {/* SCANNING */}
        {activeTab === 'scanner' && (
          <div>
            {!scanningStarted ? (
              // ÉTAT INITIAL - AFFICHER LA LISTE À PRENDRE
              <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0,0,0,0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
              }}>
                <div style={{
                  background: 'white',
                  borderRadius: '16px',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                  maxWidth: '700px',
                  width: '90%',
                  maxHeight: '85vh',
                  overflowY: 'auto',
                  animation: 'slideUp 0.3s ease',
                }}>
                  {/* Header */}
                  <div style={{
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: 'white',
                    padding: '2rem',
                    borderRadius: '16px 16px 0 0',
                  }}>
                    <h2 style={{ fontSize: '24px', fontWeight: '700', margin: '0 0 0.5rem' }}>📦 Réception du jour</h2>
                    <p style={{ fontSize: '14px', opacity: 0.9, margin: '0' }}>
                      Voici les lunettes à prendre du stock local pour les mettre en présentoir
                    </p>
                  </div>

                  {/* Contenu */}
                  <div style={{ padding: '2rem' }}>
                    <div style={{
                      background: '#f9fafb',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      marginBottom: '2rem',
                    }}>
                      {inventoryList.map((item, idx) => (
                        <div
                          key={item.id}
                          style={{
                            padding: '1.2rem',
                            borderBottom: idx !== inventoryList.length - 1 ? '1px solid #e5e7eb' : 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1rem',
                          }}
                        >
                          <div style={{
                            width: '45px',
                            height: '45px',
                            background: '#667eea15',
                            borderRadius: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '20px',
                          }}>
                            👓
                          </div>
                          <div style={{ flex: 1 }}>
                            <p style={{ fontWeight: '600', margin: '0 0 0.25rem', color: '#1f2937', fontSize: '14px' }}>
                              {item.ref}
                            </p>
                            <p style={{ fontSize: '12px', color: '#6b7280', margin: '0' }}>
                              {item.forme} • {item.couleur}
                            </p>
                          </div>
                          <div style={{
                            padding: '0.5rem 1rem',
                            background: '#e0f2fe',
                            borderRadius: '8px',
                            fontWeight: '600',
                            fontSize: '13px',
                            color: '#0284c7',
                          }}>
                            Zone {item.zone}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div style={{
                      background: '#f0f9ff',
                      border: '1px solid #bfdbfe',
                      borderRadius: '10px',
                      padding: '1rem',
                      marginBottom: '2rem',
                      color: '#1e40af',
                      fontSize: '13px',
                      lineHeight: '1.6',
                    }}>
                      ℹ️ <strong>Total: {inventoryList.length} montures à scanner</strong><br/>
                      Une fois validé, chaque monture scannée apparaîtra en vert et la liste se dégrisera progressivement.
                    </div>

                    <div style={{ display: 'flex', gap: '1rem' }}>
                      <button
                        style={{
                          flex: 1,
                          padding: '1rem',
                          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '10px',
                          cursor: 'pointer',
                          fontWeight: '600',
                          fontSize: '15px',
                          transition: 'all 0.3s',
                        }}
                        onClick={() => setScanningStarted(true)}
                        onMouseOver={(e) => e.target.style.transform = 'scale(1.02)'}
                        onMouseOut={(e) => e.target.style.transform = 'scale(1)'}
                      >
                        ✓ OK, Commencer le scan
                      </button>
                    </div>
                  </div>

                  <style>{`
                    @keyframes slideUp {
                      from {
                        transform: translateY(30px);
                        opacity: 0;
                      }
                      to {
                        transform: translateY(0);
                        opacity: 1;
                      }
                    }
                  `}</style>
                </div>
              </div>
            ) : (
              // MODE SCANNING ACTIF
              <div>
                <h2 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 2rem', color: '#1f2937' }}>Scanner inventaire</h2>
                
                <div style={{
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  borderRadius: '12px',
                  padding: '2rem',
                  marginBottom: '2rem',
                  boxShadow: '0 10px 30px rgba(102, 126, 234, 0.3)',
                }}>
                  <p style={{ fontSize: '14px', opacity: 0.95, margin: '0 0 1.5rem' }}>
                    🔍 Scannez les montures du stock local à placer en présentoir
                  </p>

                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <input
                      type="text"
                      placeholder="Entrez l'ID ou référence (ex: M001 ou AV-BL-001)"
                      value={scanInput}
                      onChange={(e) => setScanInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleScan()}
                      autoFocus
                      style={{
                        flex: 1,
                        padding: '0.875rem 1rem',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        background: 'rgba(255,255,255,0.95)',
                        color: '#1f2937',
                      }}
                    />
                    <button
                      onClick={handleScan}
                      style={{
                        padding: '0.875rem 2rem',
                        background: 'rgba(255,255,255,0.2)',
                        color: 'white',
                        border: '2px solid white',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontWeight: '600',
                        fontSize: '14px',
                        transition: 'all 0.3s',
                      }}
                      onMouseOver={(e) => {
                        e.target.style.background = 'white';
                        e.target.style.color = '#667eea';
                      }}
                      onMouseOut={(e) => {
                        e.target.style.background = 'rgba(255,255,255,0.2)';
                        e.target.style.color = 'white';
                      }}
                    >
                      Scanner
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem' }}>
                  {/* Liste avec progression */}
                  <div style={{
                    background: 'white',
                    borderRadius: '12px',
                    padding: '2rem',
                    boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
                    border: '1px solid #f3f4f6',
                  }}>
                    <h3 style={{ fontSize: '16px', fontWeight: '600', margin: '0 0 1.5rem', color: '#1f2937' }}>
                      Montures à scanner ({inventoryList.length})
                    </h3>
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '1rem',
                      maxHeight: '500px',
                      overflowY: 'auto',
                    }}>
                      {inventoryList.map(item => {
                        const isScanned = scannedItems.find(s => s.id === item.id);
                        return (
                          <div
                            key={item.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '1rem',
                              padding: '1rem',
                              background: isScanned ? '#d1fae5' : '#fef3c7',
                              border: `2px solid ${isScanned ? '#6ee7b7' : '#fcd34d'}`,
                              borderRadius: '10px',
                              opacity: isScanned ? 1 : 0.8,
                              transition: 'all 0.4s ease',
                            }}
                          >
                            <div style={{
                              width: '40px',
                              height: '40px',
                              background: isScanned ? '#10b981' : '#f59e0b',
                              borderRadius: '8px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'white',
                              fontWeight: '600',
                              fontSize: '18px',
                            }}>
                              {isScanned ? '✓' : '👓'}
                            </div>
                            <div style={{ flex: 1 }}>
                              <p style={{ fontWeight: '600', margin: '0 0 0.25rem', color: isScanned ? '#065f46' : '#1f2937' }}>{item.ref}</p>
                              <p style={{ fontSize: '12px', color: isScanned ? '#047857' : '#6b7280', margin: '0' }}>
                                {item.forme} • {item.couleur}
                              </p>
                            </div>
                            {isScanned && (
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                padding: '0.5rem 1rem',
                                background: '#a7f3d0',
                                borderRadius: '6px',
                              }}>
                                <span style={{ fontSize: '12px', fontWeight: '600', color: '#065f46' }}>Zone {item.zone}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Résumé et statistiques */}
                  <div>
                    <div style={{
                      background: scannedItems.length === inventoryList.length ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      color: 'white',
                      borderRadius: '12px',
                      padding: '2rem',
                      boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
                      textAlign: 'center',
                      marginBottom: '2rem',
                    }}>
                      <p style={{ fontSize: '13px', opacity: 0.9, margin: '0 0 0.75rem' }}>Scannées</p>
                      <p style={{ fontSize: '48px', fontWeight: '700', margin: '0 0 1rem' }}>{scannedItems.length}</p>
                      <p style={{ fontSize: '13px', opacity: 0.9, margin: '0 0 1rem' }}>
                        {inventoryList.length - scannedItems.length} restante(s)
                      </p>
                      <div style={{
                        background: 'rgba(255,255,255,0.2)',
                        borderRadius: '8px',
                        padding: '0.5rem',
                        marginTop: '1rem',
                      }}>
                        <div style={{ height: '6px', background: 'rgba(255,255,255,0.3)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{
                            height: '100%',
                            background: 'white',
                            width: `${(scannedItems.length / inventoryList.length) * 100}%`,
                            transition: 'width 0.4s ease',
                          }} />
                        </div>
                      </div>
                    </div>

                    <div style={{
                      background: 'white',
                      borderRadius: '12px',
                      padding: '1.5rem',
                      boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
                      border: '1px solid #f3f4f6',
                    }}>
                      <h4 style={{ fontSize: '13px', fontWeight: '600', margin: '0 0 1rem', color: '#6b7280' }}>Derniers scans</h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '300px', overflowY: 'auto' }}>
                        {scannedItems.length === 0 ? (
                          <p style={{ fontSize: '13px', color: '#9ca3af', margin: '0', textAlign: 'center' }}>Aucun scan</p>
                        ) : (
                          [...scannedItems].reverse().map((item, idx) => (
                            <div key={idx} style={{
                              padding: '0.75rem',
                              background: '#dcfce7',
                              borderRadius: '6px',
                              fontSize: '12px',
                              color: '#065f46',
                              border: '1px solid #6ee7b7',
                            }}>
                              <p style={{ margin: '0 0 0.25rem', fontWeight: '600' }}>✓ {item.ref}</p>
                              <p style={{ margin: '0', color: '#047857' }}>Zone {item.zone}</p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {scannedItems.length === inventoryList.length && (
                      <button
                        onClick={() => {
                          setScanningStarted(false);
                          setScannedItems([]);
                          setScanInput('');
                        }}
                        style={{
                          width: '100%',
                          padding: '1rem',
                          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '10px',
                          fontWeight: '600',
                          fontSize: '14px',
                          cursor: 'pointer',
                          marginTop: '1rem',
                          transition: 'all 0.3s',
                        }}
                        onMouseOver={(e) => e.target.style.transform = 'scale(1.02)'}
                        onMouseOut={(e) => e.target.style.transform = 'scale(1)'}
                      >
                        ✓ Réception terminée
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STOCK */}
        {activeTab === 'stock' && (
          <div>
            <h2 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 2rem', color: '#1f2937' }}>Gestion du stock</h2>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '2rem',
              marginBottom: '2rem',
            }}>
              {/* Formes */}
              <div 
                onClick={() => setSelectedDetail({
                  title: 'Distribution des formes',
                  subtitle: 'Répartition des modèles en stock',
                  icon: '👓',
                  color: '#0284c7',
                  colorEnd: '#06b6d4',
                  stats: [
                    { label: 'Total formes', value: totalFormes }
                  ],
                  details: [
                    { name: 'Aviateur', meta: 'Classique', badge: { text: formData.aviateur + ' unités', bg: '#dbeafe', color: '#0284c7' } },
                    { name: 'Wayfarer', meta: 'Tendance', badge: { text: formData.wayfarer + ' unités', bg: '#dbeafe', color: '#0284c7' } },
                    { name: 'Rond', meta: 'Rétro', badge: { text: formData.rond + ' unités', bg: '#dbeafe', color: '#0284c7' } },
                    { name: 'Carré', meta: 'Moderne', badge: { text: formData.carre + ' unités', bg: '#dbeafe', color: '#0284c7' } },
                  ],
                  description: 'Le Wayfarer est votre modèle le plus populaire. Pensez à réapprovisionner les formes moins demandées.'
                })}
                style={{
                  background: 'white',
                  borderRadius: '12px',
                  padding: '2rem',
                  boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
                  border: '1px solid #f3f4f6',
                  cursor: 'pointer',
                  transition: 'all 0.3s',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.boxShadow = '0 12px 25px rgba(0,0,0,0.12)';
                  e.currentTarget.style.transform = 'translateY(-4px)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.08)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  <div style={{
                    width: '44px',
                    height: '44px',
                    background: '#dbeafe',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <Glasses size={24} color='#0284c7' />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: '600', margin: '0', color: '#1f2937' }}>Formes</h3>
                    <p style={{ fontSize: '12px', color: '#6b7280', margin: '0.25rem 0 0' }}>Distribution des modèles</p>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                  {Object.entries(formData).map(([forme, count]) => {
                    const percent = ((count / totalFormes) * 100).toFixed(0);
                    return (
                      <div key={forme}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                          <span style={{ fontSize: '13px', fontWeight: '500', textTransform: 'capitalize', color: '#1f2937' }}>{forme}</span>
                          <span style={{ fontSize: '13px', fontWeight: '700', color: '#0284c7' }}>{percent}% ({count})</span>
                        </div>
                        <div style={{
                          height: '8px',
                          background: '#e0f2fe',
                          borderRadius: '4px',
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            height: '100%',
                            background: 'linear-gradient(90deg, #0284c7, #06b6d4)',
                            width: `${percent}%`,
                            transition: 'width 0.3s',
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Ventes par monture */}
              <div 
                onClick={() => setSelectedDetail({
                  title: 'Ventes par monture',
                  subtitle: 'Corrélation ventes et formes',
                  icon: '📊',
                  color: '#0891b2',
                  colorEnd: '#06b6d4',
                  stats: [
                    { label: 'Lunettes vendues', value: 10 }
                  ],
                  details: [
                    { name: 'Wayfarer', meta: 'Best-seller', badge: { text: '4 unités (40%)', bg: '#cffafe', color: '#0369a1' } },
                    { name: 'Aviateur', meta: 'Très bon', badge: { text: '3 unités (30%)', bg: '#cffafe', color: '#0369a1' } },
                    { name: 'Rond', meta: 'Bon', badge: { text: '2 unités (20%)', bg: '#cffafe', color: '#0369a1' } },
                    { name: 'Carré', meta: 'À développer', badge: { text: '1 unité (10%)', bg: '#fed7aa', color: '#9a3412' } },
                  ],
                  description: '⭐ Wayfarer domine vos ventes (40%). Stratégie : augmenter stock Wayfarer, développer Carré qui sous-performe.',
                  showTableauVentes: true,
                })}
                style={{
                  background: 'white',
                  borderRadius: '12px',
                  padding: '2rem',
                  boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
                  border: '1px solid #f3f4f6',
                  cursor: 'pointer',
                  transition: 'all 0.3s',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.boxShadow = '0 12px 25px rgba(0,0,0,0.12)';
                  e.currentTarget.style.transform = 'translateY(-4px)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.08)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  <div style={{
                    width: '44px',
                    height: '44px',
                    background: '#cffafe',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <BarChart3 size={24} color='#0891b2' />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: '600', margin: '0', color: '#1f2937' }}>Ventes par monture</h3>
                    <p style={{ fontSize: '12px', color: '#6b7280', margin: '0.25rem 0 0' }}>Corrélation et stratégie</p>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                  {[
                    { forme: 'Wayfarer', count: 4, percent: 40, color: '#06b6d4' },
                    { forme: 'Aviateur', count: 3, percent: 30, color: '#06b6d4' },
                    { forme: 'Rond', count: 2, percent: 20, color: '#06b6d4' },
                    { forme: 'Carré', count: 1, percent: 10, color: '#f59e0b' },
                  ].map((item, idx) => (
                    <div key={idx}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                        <span style={{ fontSize: '13px', fontWeight: '500', color: '#1f2937' }}>{item.forme}</span>
                        <span style={{ fontSize: '13px', fontWeight: '700', color: item.color }}>{item.percent}% ({item.count})</span>
                      </div>
                      <div style={{
                        height: '8px',
                        background: '#f3f4f6',
                        borderRadius: '4px',
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          height: '100%',
                          background: `linear-gradient(90deg, ${item.color}, ${item.color}dd)`,
                          width: `${item.percent}%`,
                          transition: 'width 0.3s',
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Genres */}
              <div 
                onClick={() => setSelectedDetail({
                  title: 'Distribution par genre',
                  subtitle: 'Répartition par catégorie client',
                  icon: '👥',
                  color: '#d97706',
                  colorEnd: '#f59e0b',
                  stats: [
                    { label: 'Total unités', value: totalGenres }
                  ],
                  details: [
                    { name: 'Hommes', meta: 'Montures masculines', badge: { text: genreData.homme + ' unités', bg: '#fef3c7', color: '#d97706' } },
                    { name: 'Femmes', meta: 'Montures féminines', badge: { text: genreData.femme + ' unités', bg: '#fef3c7', color: '#d97706' } },
                    { name: 'Unisexe', meta: 'Pour tous', badge: { text: genreData.unisexe + ' unités', bg: '#fef3c7', color: '#d97706' } },
                  ],
                  description: 'Bonne répartition hommes/femmes. Les modèles unisexe gagnent en popularité, pensez à augmenter le stock.'
                })}
                style={{
                  background: 'white',
                  borderRadius: '12px',
                  padding: '2rem',
                  boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
                  border: '1px solid #f3f4f6',
                  cursor: 'pointer',
                  transition: 'all 0.3s',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.boxShadow = '0 12px 25px rgba(0,0,0,0.12)';
                  e.currentTarget.style.transform = 'translateY(-4px)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.08)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  <div style={{
                    width: '44px',
                    height: '44px',
                    background: '#fef3c7',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <Package2 size={24} color='#d97706' />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: '600', margin: '0', color: '#1f2937' }}>Genre</h3>
                    <p style={{ fontSize: '12px', color: '#6b7280', margin: '0.25rem 0 0' }}>Catégories clients</p>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                  {Object.entries(genreData).map(([genre, count]) => {
                    const percent = ((count / totalGenres) * 100).toFixed(0);
                    return (
                      <div key={genre}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                          <span style={{ fontSize: '13px', fontWeight: '500', textTransform: 'capitalize', color: '#1f2937' }}>{genre}</span>
                          <span style={{ fontSize: '13px', fontWeight: '700', color: '#d97706' }}>{percent}% ({count})</span>
                        </div>
                        <div style={{
                          height: '8px',
                          background: '#fef3c7',
                          borderRadius: '4px',
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            height: '100%',
                            background: 'linear-gradient(90deg, #d97706, #f59e0b)',
                            width: `${percent}%`,
                            transition: 'width 0.3s',
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Seuil d'alerte */}
            <div 
              onClick={() => setSelectedDetail({
                title: 'Seuil d\'alerte stock',
                subtitle: 'Configuration des limites de réapprovisionnement',
                icon: '⚠️',
                color: '#d97706',
                colorEnd: '#f59e0b',
                stats: [
                  { label: 'Seuil minimum', value: stats.stock.seuilStock + ' unités' }
                ],
                details: [
                  { name: 'Stock actuel moyen', meta: 'Par modèle', badge: { text: '32', bg: '#fef3c7', color: '#d97706' } },
                  { name: 'Modèles critiques', meta: 'Sous le seuil', badge: { text: '0', bg: '#dcfce7', color: '#16a34a' } },
                  { name: 'Temps de réappro', meta: 'Fournisseur habituel', badge: { text: '3-5 jours', bg: '#fef3c7', color: '#d97706' } },
                ],
                description: 'Vérifiez régulièrement votre stock pour respecter ce seuil minimum. Une rupture de stock peut réduire vos ventes. Pensez à commander à l\'avance si vous anticipez une forte demande.'
              })}
              style={{
                background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                borderLeft: '4px solid #d97706',
                borderRadius: '12px',
                padding: '2rem',
                display: 'flex',
                alignItems: 'center',
                gap: '2rem',
                boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
                cursor: 'pointer',
                transition: 'all 0.3s',
              }}
              onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
              onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              <div style={{
                width: '60px',
                height: '60px',
                background: '#d97706',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <AlertCircle size={32} color='white' />
              </div>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: '700', margin: '0 0 0.5rem', color: '#92400e' }}>Seuil d'alerte stock</h3>
                <p style={{ fontSize: '13px', color: '#b45309', margin: '0 0 0.75rem' }}>
                  Réapprovisionner lorsque le stock passe sous le seuil minimum
                </p>
                <div style={{
                  display: 'inline-block',
                  padding: '0.5rem 1rem',
                  background: 'white',
                  borderRadius: '8px',
                  fontSize: '20px',
                  fontWeight: '700',
                  color: '#d97706',
                }}>
                  {stats.stock.seuilStock} unités minimum
                </div>
              </div>
            </div>

            {/* Réserve actuelle - Section dédiée */}
            <h3 style={{ fontSize: '18px', fontWeight: '600', margin: '2rem 0 1.5rem', color: '#1f2937' }}>📦 Réserve actuelle</h3>
            <div style={{
              background: 'white',
              borderRadius: '12px',
              padding: '2rem',
              boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
              border: '1px solid #f3f4f6',
              marginBottom: '2rem',
            }}>
              <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 1.5rem' }}>
                Suivi des {reserveActuelle.length} paires actuellement en réserve
              </p>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}>
                {reserveActuelle.map((item, idx) => {
                  const urgence = item.jours >= 9;
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: '1rem',
                        background: urgence ? '#fef3c7' : '#f3f4f6',
                        border: `1px solid ${urgence ? '#fcd34d' : '#e5e7eb'}`,
                        borderLeft: `4px solid ${urgence ? '#f59e0b' : '#d1d5db'}`,
                        borderRadius: '8px',
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr 1fr 1fr',
                        gap: '1rem',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <p style={{ fontWeight: '600', margin: '0 0 0.25rem', color: '#1f2937' }}>{item.ref}</p>
                        <p style={{ fontSize: '12px', color: '#6b7280', margin: '0' }}>{item.client}</p>
                      </div>
                      <div>
                        <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 0.25rem' }}>Date entrée</p>
                        <p style={{ fontSize: '13px', fontWeight: '500', color: '#1f2937', margin: '0' }}>
                          {new Date(item.dateEntree).toLocaleDateString('fr-FR')}
                        </p>
                      </div>
                      <div>
                        <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 0.25rem' }}>Depuis</p>
                        <p style={{ fontSize: '13px', fontWeight: '600', color: urgence ? '#f59e0b' : '#6b7280', margin: '0' }}>
                          {item.jours} jour{item.jours > 1 ? 's' : ''}
                        </p>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <span style={{
                          padding: '0.35rem 0.75rem',
                          background: urgence ? '#fde68a' : '#e5e7eb',
                          color: urgence ? '#9a3412' : '#6b7280',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: '600',
                        }}>
                          {urgence ? '⚠️ Proche limite' : '✓ OK'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{
                background: '#f0f9ff',
                border: '1px solid #bfdbfe',
                borderRadius: '8px',
                padding: '1rem',
                marginTop: '1rem',
                color: '#1e40af',
                fontSize: '12px',
                lineHeight: '1.6',
              }}>
                ℹ️ Les paires restent en réserve <strong>maximum 10 jours</strong>. Au-delà, elles retournent automatiquement au stock local.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODALE DÉTAILS */}
      {selectedDetail && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem',
        }} onClick={() => setSelectedDetail(null)}>
          <div style={{
            background: 'white',
            borderRadius: '16px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            maxWidth: selectedDetail.showTableau ? '900px' : '500px',
            width: '100%',
            maxHeight: '85vh',
            overflowY: 'auto',
            animation: 'slideUp 0.3s ease',
          }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div style={{
              background: `linear-gradient(135deg, ${selectedDetail.color || '#667eea'} 0%, ${selectedDetail.colorEnd || '#764ba2'} 100%)`,
              color: 'white',
              padding: '2rem',
              borderRadius: '16px 16px 0 0',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
            }}>
              <div style={{
                width: '50px',
                height: '50px',
                background: 'rgba(255,255,255,0.2)',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '28px',
              }}>
                {selectedDetail.icon}
              </div>
              <div style={{ flex: 1 }}>
                <h2 style={{ fontSize: '22px', fontWeight: '700', margin: '0' }}>{selectedDetail.title}</h2>
                <p style={{ fontSize: '13px', opacity: 0.9, margin: '0.5rem 0 0' }}>{selectedDetail.subtitle}</p>
              </div>
              <button
                onClick={() => setSelectedDetail(null)}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  border: 'none',
                  color: 'white',
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>

            {/* Contenu */}
            <div style={{ padding: '2rem' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '1rem',
                marginBottom: '2rem',
              }}>
                {selectedDetail.stats && selectedDetail.stats.map((stat, idx) => (
                  <div key={idx} style={{
                    background: '#f9fafb',
                    padding: '1rem',
                    borderRadius: '10px',
                    textAlign: 'center',
                  }}>
                    <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 0.5rem' }}>{stat.label}</p>
                    <p style={{ fontSize: '24px', fontWeight: '700', margin: '0', color: selectedDetail.color || '#667eea' }}>
                      {stat.value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Tableau du laboratoire */}
              {selectedDetail.showTableau && (
                <div style={{
                  background: '#f9fafb',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  marginBottom: '1.5rem',
                }}>
                  <div style={{ padding: '1rem', background: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                    <h3 style={{ margin: '0', fontSize: '14px', fontWeight: '600', color: '#1f2937' }}>
                      Détail des montures au laboratoire
                    </h3>
                  </div>
                  <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {laboratoireData.map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          padding: '1rem',
                          borderBottom: idx !== laboratoireData.length - 1 ? '1px solid #e5e7eb' : 'none',
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr 1fr 1fr',
                          gap: '1rem',
                          alignItems: 'center',
                          fontSize: '13px',
                        }}
                      >
                        <div>
                          <p style={{ fontWeight: '600', margin: '0 0 0.25rem', color: '#1f2937' }}>{item.ref}</p>
                          <p style={{ color: '#6b7280', margin: '0' }}>{item.client}</p>
                        </div>
                        <div>
                          <p style={{ color: '#6b7280', margin: '0 0 0.25rem', fontSize: '12px' }}>Date entrée</p>
                          <p style={{ fontWeight: '500', margin: '0', color: '#1f2937' }}>
                            {new Date(item.dateEntre).toLocaleDateString('fr-FR')}
                          </p>
                        </div>
                        <div>
                          <p style={{ color: '#6b7280', margin: '0 0 0.25rem', fontSize: '12px' }}>Correction</p>
                          <p style={{ fontWeight: '500', margin: '0', color: '#1f2937', fontFamily: 'monospace' }}>{item.correction}</p>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <span style={{
                            padding: '0.35rem 0.75rem',
                            background: item.statut === 'Prêt à chercher' ? '#dcfce7' : '#fef3c7',
                            color: item.statut === 'Prêt à chercher' ? '#16a34a' : '#d97706',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: '600',
                          }}>
                            {item.statut}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tableau lunettes payées */}
              {selectedDetail.showTableauPayees && (
                <div style={{
                  background: '#f9fafb',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  marginBottom: '1.5rem',
                }}>
                  <div style={{ padding: '1rem', background: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                    <h3 style={{ margin: '0', fontSize: '14px', fontWeight: '600', color: '#1f2937' }}>
                      Lunettes payées aujourd'hui (Proforma validés - paiement reçu)
                    </h3>
                    <p style={{ margin: '0.5rem 0 0', fontSize: '12px', color: '#6b7280' }}>
                      ℹ️ 8 proformas payées = possibilité d'avoir plusieurs lunettes par proforma
                    </p>
                  </div>
                  <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {lunettesPayees.map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          padding: '1rem',
                          borderBottom: idx !== lunettesPayees.length - 1 ? '1px solid #e5e7eb' : 'none',
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr 1fr 1fr',
                          gap: '1rem',
                          alignItems: 'center',
                          fontSize: '13px',
                        }}
                      >
                        <div>
                          <p style={{ fontWeight: '600', margin: '0 0 0.25rem', color: '#1f2937' }}>{item.ref}</p>
                          <p style={{ color: '#6b7280', margin: '0' }}>{item.client}</p>
                        </div>
                        <div>
                          <p style={{ color: '#6b7280', margin: '0 0 0.25rem', fontSize: '12px' }}>Paiement reçu</p>
                          <p style={{ fontWeight: '500', margin: '0', color: '#1f2937' }}>
                            {new Date(item.datePaiement).toLocaleDateString('fr-FR')}
                          </p>
                        </div>
                        <div>
                          <p style={{ color: '#6b7280', margin: '0 0 0.25rem', fontSize: '12px' }}>Montant</p>
                          <p style={{ fontWeight: '600', margin: '0', color: '#0284c7' }}>{item.montant }FCFA</p>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                          <span style={{
                            padding: '0.35rem 0.5rem',
                            background: '#e0e7ff',
                            color: '#4338ca',
                            borderRadius: '6px',
                            fontSize: '10px',
                            fontWeight: '600',
                          }}>
                            {item.proformas} proforma{item.proformas > 1 ? 's' : ''}
                          </span>
                          <span style={{
                            padding: '0.35rem 0.75rem',
                            background: '#dbeafe',
                            color: '#0284c7',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: '600',
                          }}>
                            ✓ Payée
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tableau lunettes remises */}
              {selectedDetail.showTableauRemises && (
                <div style={{
                  background: '#f9fafb',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  marginBottom: '1.5rem',
                }}>
                  <div style={{ padding: '1rem', background: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                    <h3 style={{ margin: '0', fontSize: '14px', fontWeight: '600', color: '#1f2937' }}>
                      Lunettes remises au client (Sorties du magasin - finies par labo)
                    </h3>
                    <p style={{ margin: '0.5rem 0 0', fontSize: '12px', color: '#6b7280' }}>
                      ℹ️ Paiement reçu AVANT aujourd'hui. Labo a terminé le montage → remise au client
                    </p>
                  </div>
                  <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {lunettesRemises.map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          padding: '1rem',
                          borderBottom: idx !== lunettesRemises.length - 1 ? '1px solid #e5e7eb' : 'none',
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr 1fr 1fr',
                          gap: '1rem',
                          alignItems: 'center',
                          fontSize: '13px',
                        }}
                      >
                        <div>
                          <p style={{ fontWeight: '600', margin: '0 0 0.25rem', color: '#1f2937' }}>{item.ref}</p>
                          <p style={{ color: '#6b7280', margin: '0' }}>{item.client}</p>
                        </div>
                        <div>
                          <p style={{ color: '#6b7280', margin: '0 0 0.25rem', fontSize: '12px' }}>Payé le</p>
                          <p style={{ fontWeight: '500', margin: '0', color: '#1f2937' }}>
                            {new Date(item.datePaiement).toLocaleDateString('fr-FR')}
                          </p>
                        </div>
                        <div>
                          <p style={{ color: '#6b7280', margin: '0 0 0.25rem', fontSize: '12px' }}>Montant</p>
                          <p style={{ fontWeight: '600', margin: '0', color: '#16a34a' }}>{item.montant }FCFA</p>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <span style={{
                            padding: '0.35rem 0.75rem',
                            background: '#dcfce7',
                            color: '#16a34a',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: '600',
                          }}>
                            ✓ Remise
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tableau carrés sortis de réserve vers labo */}
              {selectedDetail.showTableauCarresLabo && (
                <div style={{
                  background: '#f9fafb',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  marginBottom: '1.5rem',
                }}>
                  <div style={{ padding: '1rem', background: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                    <h3 style={{ margin: '0', fontSize: '14px', fontWeight: '600', color: '#1f2937' }}>
                      Carrés sortis de réserve vers labo
                    </h3>
                  </div>
                  <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {carresReserveLabo.map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          padding: '1rem',
                          borderBottom: idx !== carresReserveLabo.length - 1 ? '1px solid #e5e7eb' : 'none',
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr 1fr 1fr',
                          gap: '1rem',
                          alignItems: 'center',
                          fontSize: '13px',
                        }}
                      >
                        <div>
                          <p style={{ fontWeight: '600', margin: '0 0 0.25rem', color: '#1f2937' }}>{item.ref}</p>
                          <p style={{ color: '#6b7280', margin: '0' }}>{item.client}</p>
                        </div>
                        <div>
                          <p style={{ color: '#6b7280', margin: '0 0 0.25rem', fontSize: '12px' }}>Durée réserve</p>
                          <p style={{ fontWeight: '600', margin: '0', color: '#1f2937' }}>{item.jours} jours</p>
                        </div>
                        <div>
                          <p style={{ color: '#6b7280', margin: '0 0 0.25rem', fontSize: '12px' }}>Correction</p>
                          <p style={{ fontWeight: '500', margin: '0', color: '#1f2937', fontFamily: 'monospace' }}>{item.correction}</p>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <span style={{
                            padding: '0.35rem 0.75rem',
                            background: '#f3e8ff',
                            color: '#7c3aed',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: '600',
                          }}>
                            → Labo
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tableau carrés retournés au stock */}
              {selectedDetail.showTableauCarresExpires && (
                <div style={{
                  background: '#f9fafb',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  marginBottom: '1.5rem',
                }}>
                  <div style={{ padding: '1rem', background: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                    <h3 style={{ margin: '0', fontSize: '14px', fontWeight: '600', color: '#1f2937' }}>
                      Carrés retournés au stock local
                    </h3>
                  </div>
                  <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {carresReserveExpires.map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          padding: '1rem',
                          borderBottom: idx !== carresReserveExpires.length - 1 ? '1px solid #e5e7eb' : 'none',
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr 1fr 1fr',
                          gap: '1rem',
                          alignItems: 'center',
                          fontSize: '13px',
                        }}
                      >
                        <div>
                          <p style={{ fontWeight: '600', margin: '0 0 0.25rem', color: '#1f2937' }}>{item.ref}</p>
                          <p style={{ color: '#6b7280', margin: '0', fontSize: '12px' }}>{item.raison}</p>
                        </div>
                        <div>
                          <p style={{ color: '#6b7280', margin: '0 0 0.25rem', fontSize: '12px' }}>Durée réserve</p>
                          <p style={{ fontWeight: '600', margin: '0', color: '#dc2626' }}>{item.joursReserve} jours</p>
                        </div>
                        <div>
                          <p style={{ color: '#6b7280', margin: '0 0 0.25rem', fontSize: '12px' }}>Date retour</p>
                          <p style={{ fontWeight: '500', margin: '0', color: '#1f2937' }}>
                            {new Date(item.dateRetour).toLocaleDateString('fr-FR')}
                          </p>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <span style={{
                            padding: '0.35rem 0.75rem',
                            background: '#fed7aa',
                            color: '#9a3412',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: '600',
                          }}>
                            ⚠️ Expiré
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tableau ventes par monture */}
              {selectedDetail.showTableauVentes && (
                <div style={{
                  background: '#f9fafb',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  marginBottom: '1.5rem',
                }}>
                  <div style={{ padding: '1rem', background: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                    <h3 style={{ margin: '0', fontSize: '14px', fontWeight: '600', color: '#1f2937' }}>
                      Ventes par monture (lunettes remises)
                    </h3>
                    <p style={{ margin: '0.5rem 0 0', fontSize: '12px', color: '#6b7280' }}>
                      ℹ️ Analyse basée sur les 10 lunettes remises au client
                    </p>
                  </div>
                  <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {[
                      { forme: 'Wayfarer', count: 4, percent: 40, description: 'Best-seller - augmenter stock' },
                      { forme: 'Aviateur', count: 3, percent: 30, description: 'Très bon - maintenir' },
                      { forme: 'Rond', count: 2, percent: 20, description: 'Bon - développer' },
                      { forme: 'Carré', count: 1, percent: 10, description: '⚠️ Sous-performant - stratégie?' },
                    ].map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          padding: '1rem',
                          borderBottom: idx !== 3 ? '1px solid #e5e7eb' : 'none',
                          display: 'grid',
                          gridTemplateColumns: '1.5fr 1fr 1fr 1fr',
                          gap: '1rem',
                          alignItems: 'center',
                          fontSize: '13px',
                        }}
                      >
                        <div>
                          <p style={{ fontWeight: '600', margin: '0 0 0.25rem', color: '#1f2937' }}>{item.forme}</p>
                          <p style={{ color: '#6b7280', margin: '0', fontSize: '12px' }}>{item.description}</p>
                        </div>
                        <div>
                          <p style={{ color: '#6b7280', margin: '0 0 0.25rem', fontSize: '12px' }}>Lunettes</p>
                          <p style={{ fontWeight: '600', margin: '0', color: '#1f2937' }}>{item.count}</p>
                        </div>
                        <div>
                          <p style={{ color: '#6b7280', margin: '0 0 0.25rem', fontSize: '12px' }}>%</p>
                          <p style={{ fontWeight: '600', margin: '0', color: '#0891b2' }}>{item.percent}%</p>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <div style={{
                            height: '8px',
                            width: '60px',
                            background: '#f3f4f6',
                            borderRadius: '4px',
                            overflow: 'hidden',
                          }}>
                            <div style={{
                              height: '100%',
                              background: item.count === 1 ? '#f59e0b' : '#06b6d4',
                              width: `${item.percent}%`,
                            }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: '8px',
                    padding: '1rem',
                    margin: '1rem',
                    color: '#1e40af',
                    fontSize: '12px',
                    lineHeight: '1.6',
                  }}>
                    💡 <strong>Stratégie :</strong> Wayfarer domine (40%). Augmentez son stock. Carré sous-performe (10%) - réduisez ou changez de modèle.
                  </div>
                </div>
              )}
                <div style={{
                  background: '#f9fafb',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  marginBottom: '1.5rem',
                }}>
                  {selectedDetail.details.map((item, idx) => (
                    <div key={idx} style={{
                      padding: '1.2rem',
                      borderBottom: idx !== selectedDetail.details.length - 1 ? '1px solid #e5e7eb' : 'none',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}>
                      <div>
                        <p style={{ fontSize: '14px', fontWeight: '500', margin: '0 0 0.3rem', color: '#1f2937' }}>
                          {item.name}
                        </p>
                        <p style={{ fontSize: '12px', color: '#6b7280', margin: '0' }}>
                          {item.meta}
                        </p>
                      </div>
                      <span style={{
                        padding: '0.4rem 0.8rem',
                        background: item.badge?.bg || '#e0f2fe',
                        color: item.badge?.color || '#0284c7',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: '600',
                      }}>
                        {item.badge?.text}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {selectedDetail.description && (
                <div style={{
                  background: '#f0f9ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '10px',
                  padding: '1.2rem',
                  color: '#1e40af',
                  fontSize: '13px',
                  lineHeight: '1.6',
                }}>
                  {selectedDetail.description}
                </div>
              )}
            </div>

            <style>{`
              @keyframes slideUp {
                from {
                  transform: translateY(30px);
                  opacity: 0;
                }
                to {
                  transform: translateY(0);
                  opacity: 1;
                }
              }
            `}</style>
          </div>
        </div>
      )}
    </div>
  );
}