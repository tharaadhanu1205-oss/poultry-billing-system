const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors'); // This is the magic key 🔑
const app = express();

// These TWO lines must come before any routes!
app.use(cors()); 
app.use(express.json());

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '', // Your MySQL password here
    database: 'poultrybillingdb'
});



// Test the database connection as soon as server starts
pool.getConnection()
    .then(() => console.log("✅ MySQL Database Connected!"))
    .catch(err => console.error("❌ MySQL Connection Failed:", err.message));

// --- ROUTES ---



// 1. Admin Login
app.post('/login', async (req, res) => {
    const { Username, Password } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM Users WHERE Username = ? AND Password = ?', [Username, Password]);
        if (rows.length > 0) res.send('Login Success');
        else res.send('Invalid Credentials');
    } catch (err) {
        res.status(500).send('Database error');
    }
});
app.post('/add-customer', async (req, res) => {
    const { Name, Phone, Address } = req.body;
    try {
        await pool.query(
            "INSERT INTO Customers (Customer_Name, Phone, Address) VALUES (?, ?, ?)",
            [Name, Phone, Address]
        );
        res.send("Customer Added Successfully");
    } catch (err) {
        res.status(500).send("Error adding customer");
    }
});

// 2. Add New Product

// ADD NEW PRODUCT ENDPOINT
app.post('/add-product', async (req, res) => {
    const { name, price, stock } = req.body;

    // VALIDATION: Ensure no empty data is sent to MySQL
    if (!name || !price || !stock) {
        return res.status(400).json({ success: false, message: "All fields are required!" });
    }

    try {
        const [result] = await pool.query(
            "INSERT INTO Products (Product_Name, Price_Per_Kg, Stock_Quantity) VALUES (?, ?, ?)",
            [name, price, stock]
        );

        res.status(200).json({ 
            success: true, 
            message: "Product added successfully!",
            id: result.insertId 
        });
    } catch (err) {
        console.error("Database Error:", err);
        res.status(500).send("Failed to add product.");
    }
});

// 3. Get All Products (CORRECTED)
app.get('/products', async (req, res) => {
    try {
        // We keep the real database names: Product_ID, Product_Name, Price_Per_Kg, Stock_Quantity
        const [rows] = await pool.query('SELECT * FROM Products');
        res.json(rows);
    } catch (err) {
        res.status(500).send('Error fetching products');
    }
});

// 4. Update Daily Price (CORRECTED)
app.post('/update-price', async (req, res) => {
    // We use the same names the frontend will send
    const { ProductID, Price } = req.body;
    
    try {
        // MATCH: Price_Per_Kg is the column, Product_ID is the key
        await pool.query(
            'UPDATE Products SET Price_Per_Kg = ? WHERE Product_ID = ?', 
            [Price, ProductID]
        );
        res.json({ success: true, message: 'Price Updated Successfully' });
    } catch (err) {
        console.error("Update Error:", err);
        res.status(500).send('Error updating price');
    }
});

 // 5. Create Order (Billing & Inventory Update)
// Inside server.js
app.post('/generate-bill-bulk', async (req, res) => {
    const { CustomerName, Items, TotalAmount } = req.body;
    try {
        // Insert Bill
        const [result] = await pool.query(
            'INSERT INTO bills (Customer_Name, Total_Amount) VALUES (?, ?)', 
            [CustomerName, TotalAmount]
        );
        
        // Update Stock
        for (const item of Items) {
            await pool.query(
                'UPDATE products SET Stock_Quantity = Stock_Quantity - ? WHERE Product_ID = ?', 
                [item.qty, item.id]
            );
        }
        res.status(200).json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send("Database Error");
    }
});

// 6. Add Wastage (CORRECTED)
app.post('/add-wastage', async (req, res) => {
    const { ProductID, Quantity, Cost } = req.body; 
    
    try {
        // 1. Record the wastage (We put the Cost into the Reason string for now)
        await pool.query(
            'INSERT INTO Wastage (Product_ID, Quantity, Reason) VALUES (?, ?, ?)', 
            [ProductID, Quantity, `Loss: ₹${Cost}`]
        );
            
        // 2. Subtract from Inventory (Stock_Quantity must match your Products table)
        await pool.query(
            'UPDATE Products SET Stock_Quantity = Stock_Quantity - ? WHERE Product_ID = ?', 
            [Quantity, ProductID]
        );

        res.json({ success: true, message: 'Wastage Recorded and Stock Updated' });
    } catch (err) {
        console.error("Wastage Error:", err);
        res.status(500).send('Error recording wastage');
    }
});

// 7. Overall Sales Report (CORRECTED to use 'Bills' table)
// 7. Overall Sales Report (BULLETPROOF VERSION)
app.get('/sales-report', async (req, res) => {
    try {
        // 1. Get Sum of Sales
        const [salesRows] = await pool.query('SELECT SUM(Total_Amount) as Totalsales FROM bills');
        const totalSales = parseFloat(salesRows[0].Totalsales) || 0;

        // 2. Get Sum of REAL Loss Amount (The column you just added!)
        const [wasteRows] = await pool.query('SELECT SUM(Loss_Amount) as TotalWaste FROM wastage');
        const totalWaste = parseFloat(wasteRows[0].TotalWaste) || 0;

        // 3. Send to Dashboard
        res.json({
            Totalsales: totalSales,
            TotalWaste: totalWaste,
            Profit: totalSales - totalWaste
        });
    } catch (err) {
        console.error("Dashboard Sync Error:", err.message);
        res.json({ Totalsales: 0, TotalWaste: 0, Profit: 0 });
    }
});

app.post('/log-wastage', async (req, res) => {
    const { ProductID, Quantity, Reason, LossAmount } = req.body;
    try {
        await pool.query(
            'INSERT INTO wastage (Product_ID, Quantity, Reason, Loss_Amount) VALUES (?, ?, ?, ?)', 
            [ProductID, Quantity, Reason, LossAmount]
        );
        res.json({ success: true, message: "Wastage logged!" });
    } catch (err) {
        res.status(500).send("Error saving wastage");
    }
});

// 8. Date-wise Sales (CORRECTED to use 'Bills' table)
app.get('/sales-report-date', async (req, res) => {
    try {
        // Fix: Use 'Bills' and 'Date' to match your database structure
        const [rows] = await pool.query(`
            SELECT DATE(Date) as date, SUM(Total_Amount) as totalSales 
            FROM Bills 
            GROUP BY DATE(Date) 
            ORDER BY date ASC LIMIT 7
        `);
        res.json(rows);
    } catch (err) {
        console.error("Chart Error:", err);
        res.status(500).send('Error fetching chart data');
    }
});
// 9. Delete Product (CORRECTED)
app.delete('/delete-product/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // Fix: Use 'Bills' if you have linked items, or just delete the product
        // If your database has 'Foreign Keys', we delete the product's trace first
        // await pool.query('DELETE FROM Bills WHERE Product_ID = ?', [id]); 
        
        const [result] = await pool.query('DELETE FROM Products WHERE Product_ID = ?', [id]);
        
        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Product Deleted Successfully' });
        } else {
            res.status(404).send('Product not found');
        }
    } catch (err) {
        console.error("Delete Error:", err);
        res.status(500).send('Error: Could not delete product');
    }
});

// 10. Update Product Route (CORRECTED for Modal Edit)
app.put('/update-product/:id', async (req, res) => {
    const { id } = req.params;
    const { Price, Stock } = req.body; // These come from your Edit Modal
    try {
        // Fix: Column names must be Price_Per_Kg and Stock_Quantity
        await pool.query(
           'UPDATE products SET Price_Per_Kg = ?, Stock_Quantity = ? WHERE Product_ID = ?',
            [Price, Stock, id]
        );
        res.json({ success: true, message: 'Product Updated Successfully' });
    } catch (err) {
        console.error("Update Error:", err);
        res.status(500).send('Error updating product in database');
    }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});