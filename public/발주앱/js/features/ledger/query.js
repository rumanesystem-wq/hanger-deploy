// ============================================================
// features/ledger/query.js — 원장 데이터 가져오기/저장 (Mock 데이터)
// 추후 Firestore 쿼리·쓰기로 교체 예정
// ============================================================

/**
 * Mock 데이터 — 발주서 + 품목 상세
 * items: [{ name, color, qty, unitPrice }]
 *   - 표시: name [color] / qty * unitPrice = amount (부가세 포함)
 *   - 실제 Firestore 연결 시 upperMaterials/shelfItems/drawerItems 등에서 추출
 * @type {Order[]}
 */
const LEDGER_MOCK_ORDERS = [
  { id: 1, orderNum: '20260601-001', status: '출고완료', orderDate: '2026-06-01', shipDate: '2026-06-03', deliveryTo: '홍길동', address: '101-204', warehouse: '시흥', totalSupply: 150000, totalVat: 15000, totalAmount: 165000,
    items: [
      { name: '포스트바 2250', color: '화이트', qty: 9, unitPrice: 10000 },
      { name: '선반바 400', color: '화이트', qty: 20, unitPrice: 2000 },
      { name: '코너바 2200', color: '화이트', qty: 2, unitPrice: 5800 },
      { name: '조절발', color: '화이트', qty: 18, unitPrice: 900 },
      { name: '옷봉 2400', color: '화이트', qty: 4, unitPrice: 5000 },
    ]
  },
  { id: 2, orderNum: '20260603-001', status: '출고완료', orderDate: '2026-06-03', shipDate: '2026-06-06', deliveryTo: '홍길동', address: '909동1701호', warehouse: '시흥', totalSupply: 180000, totalVat: 18000, totalAmount: 198000,
    items: [
      { name: '포스트바 2250', color: '화이트', qty: 6, unitPrice: 10000 },
      { name: '선반바 400', color: '화이트', qty: 12, unitPrice: 2000 },
      { name: '선반', color: '솔리드 770mm', qty: 8, unitPrice: 4600 },
      { name: '겉서랍 2단', color: '솔리드', qty: 1, unitPrice: 69000 },
    ]
  },
  { id: 3, orderNum: '20260605-001', status: '출고완료', orderDate: '2026-06-05', shipDate: '2026-06-08', deliveryTo: '김철수', address: '107동1009호', warehouse: '시흥', totalSupply: 120000, totalVat: 12000, totalAmount: 132000,
    items: [
      { name: '포스트바 2250', color: '실버', qty: 4, unitPrice: 10000 },
      { name: '선반바 400', color: '실버', qty: 12, unitPrice: 2000 },
      { name: '선반', color: '스톤그레이 520mm', qty: 4, unitPrice: 3600 },
      { name: '코너선반', color: '스톤그레이 710×520', qty: 2, unitPrice: 11000 },
    ]
  },
  { id: 4, orderNum: '20260608-001', status: '출고완료', orderDate: '2026-06-08', shipDate: '2026-06-11', deliveryTo: '홍길동', address: '107동1904호', warehouse: '시흥', totalSupply: 160000, totalVat: 16000, totalAmount: 176000,
    items: [
      { name: '포스트바 2250', color: '화이트', qty: 7, unitPrice: 10000 },
      { name: '선반바 400', color: '화이트', qty: 17, unitPrice: 2000 },
      { name: '선반', color: '솔리드 770mm', qty: 6, unitPrice: 4600 },
      { name: '겉서랍 3단', color: '솔리드', qty: 1, unitPrice: 92000 },
    ]
  },
  { id: 5, orderNum: '20260610-001', status: '출고완료', orderDate: '2026-06-10', shipDate: '2026-06-13', deliveryTo: '이영희', address: '716동505호', warehouse: '시흥', totalSupply: 140000, totalVat: 14000, totalAmount: 154000,
    items: [
      { name: '포스트바 2250', color: '블랙', qty: 8, unitPrice: 11000 },
      { name: '선반바 400', color: '블랙', qty: 14, unitPrice: 2100 },
      { name: '선반', color: '스톤그레이 570mm', qty: 9, unitPrice: 4200 },
    ]
  },
  { id: 6, orderNum: '20260612-001', status: '출고완료', orderDate: '2026-06-12', shipDate: '2026-06-15', deliveryTo: '홍길동', address: '111동101호', warehouse: '평택', totalSupply: 220000, totalVat: 22000, totalAmount: 242000,
    items: [
      { name: '포스트바 2250', color: '화이트', qty: 7, unitPrice: 11000 },
      { name: '선반바 400', color: '화이트', qty: 21, unitPrice: 2100 },
      { name: '선반', color: '솔리드 770mm', qty: 7, unitPrice: 5300 },
      { name: '겉서랍 3단', color: '솔리드', qty: 1, unitPrice: 92000 },
      { name: '거울장 목대', color: '솔리드', qty: 1, unitPrice: 87000 },
    ]
  },
  { id: 7, orderNum: '20260614-001', status: '출고완료', orderDate: '2026-06-14', shipDate: '2026-06-17', deliveryTo: '김철수', address: '103-1803', warehouse: '시흥', totalSupply: 130000, totalVat: 13000, totalAmount: 143000,
    items: [
      { name: '포스트바 2250', color: '블랙', qty: 3, unitPrice: 11000 },
      { name: '선반바 400', color: '블랙', qty: 6, unitPrice: 2100 },
      { name: '선반', color: '메이플 2400mm', qty: 3, unitPrice: 16000 },
    ]
  },
  { id: 8, orderNum: '20260615-001', status: '출고완료', orderDate: '2026-06-15', shipDate: '2026-06-18', deliveryTo: '박규태', address: '송파504호', warehouse: '시흥', totalSupply: 190000, totalVat: 19000, totalAmount: 209000,
    items: [
      { name: '포스트바 2250', color: '화이트', qty: 10, unitPrice: 11000 },
      { name: '선반바 400', color: '화이트', qty: 38, unitPrice: 2100 },
      { name: '선반', color: '솔리드 370mm', qty: 14, unitPrice: 3200 },
      { name: '겉서랍 2단', color: '솔리드', qty: 2, unitPrice: 69000 },
    ]
  },
  { id: 9, orderNum: '20260617-001', status: '출고완료', orderDate: '2026-06-17', shipDate: '2026-06-20', deliveryTo: '이영희', address: '호매실402호', warehouse: '평택', totalSupply: 175000, totalVat: 17500, totalAmount: 192500,
    items: [
      { name: '포스트바 2250', color: '실버', qty: 5, unitPrice: 11000 },
      { name: '선반바 400', color: '실버', qty: 9, unitPrice: 2100 },
      { name: '선반', color: '스톤그레이 570mm', qty: 6, unitPrice: 4200 },
      { name: '코너선반', color: '스톤그레이 780×585', qty: 3, unitPrice: 13000 },
    ]
  },
  { id: 10, orderNum: '20260620-001', status: '출고완료', orderDate: '2026-06-20', shipDate: '2026-06-23', deliveryTo: '박규태', address: '광주 2층계단', warehouse: '평택', totalSupply: 210000, totalVat: 21000, totalAmount: 231000,
    items: [
      { name: '포스트바 2250', color: '화이트', qty: 9, unitPrice: 11000 },
      { name: '선반바 400', color: '화이트', qty: 24, unitPrice: 2100 },
      { name: '겉서랍 4단', color: '솔리드', qty: 1, unitPrice: 139000 },
    ]
  },
  { id: 11, orderNum: '20260622-001', status: '출고완료', orderDate: '2026-06-22', shipDate: '2026-06-25', deliveryTo: '홍길동', address: '102-804', warehouse: '시흥', totalSupply: 165000, totalVat: 16500, totalAmount: 181500,
    items: [
      { name: '포스트바 2250', color: '골드', qty: 12, unitPrice: 11000 },
      { name: '선반바 400', color: '골드', qty: 34, unitPrice: 2100 },
      { name: '선반', color: '스톤그레이 570mm', qty: 21, unitPrice: 4200 },
    ]
  },
  { id: 12, orderNum: '20260624-001', status: '출고완료', orderDate: '2026-06-24', shipDate: '2026-06-27', deliveryTo: '김철수', address: '303-1704', warehouse: '시흥', totalSupply: 155000, totalVat: 15500, totalAmount: 170500,
    items: [
      { name: '포스트바 2250', color: '화이트', qty: 5, unitPrice: 11000 },
      { name: '선반바 400', color: '화이트', qty: 10, unitPrice: 2100 },
      { name: '겉서랍 3단', color: '화이트 오크', qty: 1, unitPrice: 92000 },
    ]
  },
  { id: 13, orderNum: '20260625-001', status: '출고완료', orderDate: '2026-06-25', shipDate: '2026-06-28', deliveryTo: '이영희', address: '103-1203', warehouse: '평택', totalSupply: 185000, totalVat: 18500, totalAmount: 203500,
    items: [
      { name: '포스트바 2250', color: '골드', qty: 15, unitPrice: 11000 },
      { name: '선반바 400', color: '골드', qty: 24, unitPrice: 2100 },
      { name: '이불 긴장문', color: '메이플', qty: 2, unitPrice: 70000 },
    ]
  },
];

/** @type {Payment[]} */
let LEDGER_MOCK_PAYMENTS = [
  { id: 'p1', customer: '홍길동', date: '2026-06-08', amount: 500000, memo: '6월 1차 정산' },
  { id: 'p2', customer: '박규태', date: '2026-06-22', amount: 440000, memo: '계좌이체' },
  { id: 'p3', customer: '김철수', date: '2026-06-10', amount: 200000, memo: '카드결제' },
  { id: 'p4', customer: '홍길동', date: '2026-06-20', amount: 300000, memo: '현금' },

];

/**
 * 전체 출고완료 발주서 조회
 * (추후 firebase.firestore().collection('hanger_orders').where('status','==','출고완료').get())
 * @returns {Promise<Order[]>}
 */
async function fetchAllCompletedOrders() {
  return LEDGER_MOCK_ORDERS.filter(o => o.status === '출고완료');
}

/**
 * 전체 입금 내역 조회
 * (추후 firebase.firestore().collection('hanger_payments').get())
 * @returns {Promise<Payment[]>}
 */
async function fetchAllPayments() {
  return [...LEDGER_MOCK_PAYMENTS];
}

/**
 * 입금 등록
 * (추후 firebase.firestore().collection('hanger_payments').add({...}))
 * @param {Omit<Payment, 'id'>} payment
 * @returns {Promise<Payment>} 저장된 (id 부여된) 입금 데이터
 */
async function createPayment(payment) {
  /** @type {Payment} */
  const saved = {
    ...payment,
    id: 'p' + Date.now()
  };
  LEDGER_MOCK_PAYMENTS.push(saved);
  return saved;
}

/**
 * 입금 삭제
 * (추후 firebase.firestore().collection('hanger_payments').doc(id).delete())
 * @param {string} paymentId
 * @returns {Promise<void>}
 */
async function deletePayment(paymentId) {
  LEDGER_MOCK_PAYMENTS = LEDGER_MOCK_PAYMENTS.filter(p => p.id !== paymentId);
}
