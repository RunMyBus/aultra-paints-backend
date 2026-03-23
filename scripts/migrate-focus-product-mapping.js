/**
 * Migration Script: Add focusProductMapping to existing products
 * 
 * This script migrates existing products that have a single focusProductId
 * to use the new focusProductMapping structure. It creates mapping entries
 * for all volumes using the same focusProductId.
 * 
 * Usage:
 *   node scripts/migrate-focus-product-mapping.js
 */

const mongoose = require('mongoose');
const productOffersModel = require('../models/productOffers.model');
const logger = require('../utils/logger');

// Load environment variables
require('dotenv').config();

async function migrateProducts() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        
        logger.info('Connected to MongoDB');
        
        // Find all products that have focusProductId but no focusProductMapping
        const productsToMigrate = await productOffersModel.find({
            focusProductId: { $exists: true, $ne: null },
            $or: [
                { focusProductMapping: { $exists: false } },
                { focusProductMapping: { $size: 0 } }
            ]
        });
        
        logger.info(`Found ${productsToMigrate.length} products to migrate`);
        
        let migratedCount = 0;
        let skippedCount = 0;
        
        for (const product of productsToMigrate) {
            try {
                // Extract unique volumes from the price array
                const volumes = [...new Set(product.price.map(p => p.volume))].filter(v => v);
                
                if (volumes.length === 0) {
                    logger.warn(`Product ${product._id} (${product.productOfferDescription}) has no volumes, skipping`);
                    skippedCount++;
                    continue;
                }
                
                // Create mapping entries for all volumes using the same focusProductId
                const mappings = volumes.map(volume => ({
                    volume: volume,
                    focusProductId: product.focusProductId,
                    focusUnitId: product.focusUnitId || 1
                }));
                
                // Update the product
                await productOffersModel.updateOne(
                    { _id: product._id },
                    { $set: { focusProductMapping: mappings } }
                );
                
                logger.info(`Migrated product ${product._id} (${product.productOfferDescription}) with ${mappings.length} volume mappings`);
                migratedCount++;
                
            } catch (error) {
                logger.error(`Error migrating product ${product._id}:`, error);
            }
        }
        
        logger.info(`Migration complete: ${migratedCount} products migrated, ${skippedCount} skipped`);
        
    } catch (error) {
        logger.error('Migration failed:', error);
        throw error;
    } finally {
        await mongoose.connection.close();
        logger.info('Database connection closed');
    }
}

// Run the migration
migrateProducts()
    .then(() => {
        console.log('Migration completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Migration failed:', error);
        process.exit(1);
    });
